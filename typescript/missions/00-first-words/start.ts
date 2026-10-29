// Mission 00, First words: get an agent talking back in a voice you picked.
//
// Run it:    make run 00   (or, from typescript/: pnpm tsx missions/00-first-words/start.ts)
//            needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop make run 00
// Check it:  make check 00     (offline, no key)
// Live:      make live 00      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env)
//
// Three TODOs below. The brief is in ../../../missions/00-first-words/README.md.

import { isMain, listenProvider, run, type Agent, type AgentEvent, type Settings } from '../../src/common.js';

// TODO 1: Write your own prompt. Who is the agent, how does it talk, and one rule
// it always follows. A sentence or three is plenty.
const PROMPT = 'You are a helpful assistant.';

// TODO 2: Pick a different voice by id: flux-cliff-en, flux-alexis-en or flux-rufus-en, or one from the brief.
const VOICE = 'flux-hannah-en';

// TODO 3: Give it a greeting: the first thing it says when you connect.
const GREETING = '';

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
