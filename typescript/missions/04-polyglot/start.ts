// Mission 04, Polyglot: one listener for every language, and a voice that follows.
//
// Run it:    make run 04   (or, from typescript/: pnpm tsx missions/04-polyglot/start.ts)
//            needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop make run 04
// Check it:  make check 04     (offline, no key)
// Live:      make live 04      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env)
//
// Three TODOs below. The brief is in ../../../missions/04-polyglot/README.md.

import { isMain, run, type Agent, type AgentEvent, type Settings } from '../../src/common.js';

// TODO 1: Switch to the multilingual listener, flux-general-multi, and list the
// languages you expect to hear as hints (two-letter language codes such as 'en', 'es', 'fr'), including one beyond 'en'
// and 'es', such as ['en', 'es', 'fr'].
const LISTEN_MODEL: string = 'flux-general-en';
const LANGUAGE_HINTS: string[] = [];

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
    // TODO 2: When `heard` is set, differs from voice.language and VOICES has a voice for it,
    // switch once: keep the old language in voice.previous, set voice.language to `heard`, send
    // the new speak block, and print the switch so you see it:
    // if (heard && heard !== voice.language && heard in VOICES) {
    //   voice.previous = ...;
    //   voice.language = ...;
    //   agent.updateSpeak(speakFor(heard));
    //   console.log(`[voice] switching to ${VOICES[heard]} from the next reply`);
    // }
    void heard; // marks heard as read until TODO 2 uses it (an editor greys it out otherwise); delete this line with TODO 2
  } else if (event.type === 'SpeakUpdated') {
    voice.previous = null;
  } else if (event.type === 'Error') {
    // TODO 3: A failed switch ends the call: the server closes the connection right after this
    // Error. If a switch was waiting (voice.previous is set), print one clear line, which voice
    // failed and why, then hang up with `agent.close()` so the program ends cleanly:
    // if (voice.previous) {
    //   const reason = event.description ?? event.code;
    //   console.log(`[voice] couldn't switch to ${VOICES[voice.language]}: ${reason}`);
    //   agent.close();
    // }
  }
}

if (isMain(import.meta.url)) await run({ buildSettings, onEvent });
