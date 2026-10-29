// Mission 00, First words: get an agent talking back in a voice you picked.
//
// Run it:    pnpm tsx missions/00-first-words/solution.ts
// Check it:  make check 00      (offline, no key)
// Live:      make live 00       (real API, uses your DEEPGRAM_API_KEY)
//
// Reference solution. Try start.ts first.

import { isMain, listenProvider, run, type Agent, type AgentEvent, type Settings } from '../../src/common.js';

// Your own prompt: who it is, how it talks, one rule.
const PROMPT =
  'You are Sam, the barista at a tiny cafe. Answer in one short sentence, ' +
  'then ask one question back. Never recommend decaf.';

// A different voice from the default.
const VOICE = 'flux-cliff-en';

// The first thing it says when you connect.
const GREETING = 'Hi, welcome in. What can I get started for you?';

/** The Settings message: sent once, as soon as the server says Welcome. */
export function buildSettings(): Settings {
  return {
    audio: {
      input: { encoding: 'linear16', sample_rate: 16000 },
      output: { encoding: 'linear16', sample_rate: 24000, container: 'none' },
    },
    agent: {
      listen: { provider: listenProvider() },
      think: { provider: { type: 'open_ai', model: 'gpt-4o-mini' }, prompt: PROMPT },
      speak: { provider: { type: 'deepgram', model: VOICE, version: 'v2' } },
      ...(GREETING ? { greeting: GREETING } : {}),
    },
  } as Settings;
}

/** Every event from the agent lands here. common.ts already prints the transcript. */
export async function onEvent(_agent: Agent, _event: AgentEvent): Promise<void> {}

if (isMain(import.meta.url)) await run({ buildSettings, onEvent });
