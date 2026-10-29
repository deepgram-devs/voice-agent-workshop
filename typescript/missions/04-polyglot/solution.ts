// Mission 04, Polyglot: one listener for every language, and a voice that follows.
//
// Run it:    pnpm tsx missions/04-polyglot/solution.ts
// Check it:  make check 04      (offline, no key)
// Live:      make live 04       (real API, uses your DEEPGRAM_API_KEY)
//
// Reference solution. Try start.ts first.

import { isMain, run, type Agent, type AgentEvent, type Settings } from '../../src/common.js';

// The multilingual listener, and the languages you expect to hear.
const LISTEN_MODEL: string = 'flux-general-multi';
const LANGUAGE_HINTS: string[] = ['en', 'es', 'fr'];

const PROMPT =
  'You are a friendly help desk at a conference. Answer in one or two short ' +
  'sentences, always in the language the person just used.';

// One Aura-2 voice per language. To try other voices, including multi_tts
// voices, swap the ids here and nothing else changes.
const VOICES: Record<string, string> = {
  en: 'aura-2-thalia-en',
  es: 'aura-2-celeste-es',
  de: 'aura-2-julius-de',
  fr: 'aura-2-agathe-fr',
  it: 'aura-2-livia-it',
  nl: 'aura-2-rhea-nl',
  ja: 'aura-2-izanami-ja',
};
const START_LANGUAGE = 'en';

/** The `speak` block for one language's voice, for Settings and UpdateSpeak. */
function speakFor(language: string) {
  return { provider: { type: 'deepgram' as const, model: VOICES[language] } };
}

/**
 * The language a user turn was mostly in ("es" from "es-419"), or null.
 * `languages` lists what the listener heard, most words first.
 */
function firstLanguage(event: AgentEvent): string | null {
  const heard = Array.isArray(event.languages) ? event.languages : [];
  return heard.length ? String(heard[0]).split('-')[0].toLowerCase() : null;
}

/** Which voice the agent speaks with, and the one it had before a switch. */
const voice: { language: string; previous: string | null } = { language: START_LANGUAGE, previous: null };

/** The Settings message: sent once, as soon as the server says Welcome. */
export function buildSettings(): Settings {
  return {
    audio: {
      input: { encoding: 'linear16', sample_rate: 16000 },
      output: { encoding: 'linear16', sample_rate: 24000, container: 'none' },
    },
    agent: {
      listen: {
        provider: {
          type: 'deepgram',
          model: LISTEN_MODEL,
          version: 'v2',
          ...(LANGUAGE_HINTS.length ? { language_hints: LANGUAGE_HINTS } : {}),
        },
      },
      think: { provider: { type: 'open_ai', model: 'gpt-4o-mini' }, prompt: PROMPT },
      speak: speakFor(START_LANGUAGE),
    },
  } as Settings;
}

export async function onEvent(agent: Agent, event: AgentEvent): Promise<void> {
  if (event.type === 'Welcome') {
    // A new call starts with the starting voice.
    voice.language = START_LANGUAGE;
    voice.previous = null;
  } else if (event.type === 'ConversationText' && event.role === 'user') {
    const heard = firstLanguage(event);
    if (heard && heard !== voice.language && heard in VOICES) {
      // Switch once: remember the old voice in case the switch fails.
      voice.previous = voice.language;
      voice.language = heard;
      agent.updateSpeak(speakFor(heard));
      console.log(`[voice] switching to ${VOICES[heard]} from the next reply`);
    }
  } else if (event.type === 'SpeakUpdated') {
    voice.previous = null;
  } else if (event.type === 'Error' && voice.previous) {
    // The switch failed, and the server ends the call after this error.
    // Say what happened in one line and hang up, so the program ends cleanly.
    // The line below adds its own period.
    const reason = String(event.description ?? event.code ?? 'no reason given').replace(/\.$/, '');
    console.log(`[voice] couldn't switch to ${VOICES[voice.language]}: ${reason}. Ending the call.`);
    agent.close();
  }
}

if (isMain(import.meta.url)) await run({ buildSettings, onEvent });
