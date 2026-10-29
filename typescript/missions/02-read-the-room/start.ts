// Mission 02, Read the room: notice a frustrated caller and change course once.
//
// Run it:    make run 02   (or, from typescript/: pnpm tsx missions/02-read-the-room/start.ts)
//            needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop make run 02
// Check it:  make check 02     (offline, no key)
// Live:      make live 02      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env; the timing feature too, see the README)
//
// Three TODOs below. The brief is in ../../../missions/02-read-the-room/README.md.

import { isMain, listenProvider, run, type Agent, type AgentEvent, type Settings } from '../../src/common.js';

const PROMPT =
  'You are a patient receptionist at a developer conference. ' +
  'Keep replies to one or two short sentences. Never use markdown or emoji.';

// TODO 1: Pick a frustration limit: how many annoyed turns before FrustrationDetected
// says escalated. A whole number from 1 to 5.
const FRUSTRATION_LIMIT: number | null = null;

// TODO 2: UpdatePrompt adds to the prompt the agent already has. This sends the
// whole prompt again, so the agent ends up with it twice. Keep only the new lines.
const RECOVERY =
  PROMPT +
  ' The caller is frustrated. Say sorry once, stop asking questions, ' +
  'and offer to have someone from registration call them back within the hour.';

// One call, one recovery. Reset when a new call starts.
let recovered = false;

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
      speak: { provider: { type: 'deepgram', model: 'flux-hannah-en', version: 'v2' } },
      // The timing block sits beside listen, think and speak, cast through Settings.
      think_live: {
        provider: {
          type: 'deepgram',
          version: 'v1',
          ...(FRUSTRATION_LIMIT !== null ? { frustration_max_count: FRUSTRATION_LIMIT } : {}),
        },
      },
    },
  } as Settings;
}

/** Every event from the agent lands here, as plain wire JSON. */
export async function onEvent(agent: Agent, event: AgentEvent): Promise<void> {
  if (event.type === 'Welcome') {
    recovered = false; // a new call
  } else if (event.type === 'FrustrationDetected') {
    console.log(`[frustration] count ${event.count}, escalated ${event.escalated}`);
    // TODO 3: This sends the recovery on every frustration event, so the agent
    // apologizes again and again. Send it once: the first time `escalated` is
    // true. The `recovered` flag above is there to help.
    agent.updatePrompt(RECOVERY);
  }
}

if (isMain(import.meta.url)) await run({ buildSettings, onEvent });
