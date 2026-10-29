// Mission 06, Encore (bonus): push Speed and Expressivity until it does an impression.
//
// Run it:    make run 06   (or, from typescript/: pnpm tsx missions/06-encore/start.ts)
//            needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop make run 06
// Check it:  make check 06     (offline, no key)
// Live:      make live 06      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env)
//
// Three TODOs below. The brief is in ../../../missions/06-encore/README.md.

import { isMain, listenProvider, run, type Agent, type AgentEvent, type Settings } from '../../src/common.js';

// TODO 1: Ask for a performance: who is talking, and what they narrate.
const PROMPT = 'You are a helpful assistant.';

// A Flux voice (version v2): Speed and Expressivity belong to Flux voices.
const VOICE = 'flux-hannah-en';

// TODO 2: Change the speed: 0.85 to 1.15, in steps of 0.05. 1 is normal.
const SPEED: number = 1.0;

// TODO 3: Change the expressivity: a whole number from -2 (calm) to 2 (animated).
// 0 is the voice's own delivery. It holds for the whole call.
const EXPRESSIVITY: number = 0;

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
