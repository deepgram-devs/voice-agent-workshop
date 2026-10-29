// Mission 06, Encore (bonus): push Speed and Expressivity until it does an impression.
//
// Run it:    pnpm tsx missions/06-encore/solution.ts
// Check it:  make check 06      (offline, no key)
// Live:      make live 06       (real API, uses your DEEPGRAM_API_KEY)
//
// Reference solution. Try start.ts first.

import { isMain, listenProvider, run, type Agent, type AgentEvent, type Settings } from '../../src/common.js';

// A performance, not a persona: who is talking, and what they narrate.
const PROMPT =
  'You are a nature documentary narrator describing whatever the listener says as if it ' +
  'were a rare animal in the wild. Hushed, awed, one or two sentences a turn. Never break character.';

// A Flux voice (version v2): Speed and Expressivity belong to Flux voices.
const VOICE = 'flux-hannah-en';

// Slower, for gravitas.
const SPEED: number = 0.9;

// Leaning into the words. It holds for the whole call.
const EXPRESSIVITY: number = 1;

const GREETING = 'Ready when you are. Tell me what you see.';

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
      speak: { provider: { type: 'deepgram', model: VOICE, version: 'v2', speed: SPEED, expressivity: EXPRESSIVITY } },
      greeting: GREETING,
    },
  } as Settings;
}

/** Every event from the agent lands here. common.ts already prints the transcript. */
export async function onEvent(_agent: Agent, _event: AgentEvent): Promise<void> {}

if (isMain(import.meta.url)) await run({ buildSettings, onEvent });
