// Mission 02, Read the room: notice a frustrated caller and change course once.
//
// Run it:    pnpm tsx missions/02-read-the-room/solution.ts
// Check it:  make check 02      (offline, no key)
// Live:      make live 02       (real API; needs the `timing` feature, see the README)
//
// Reference solution. Try start.ts first.

import { isMain, listenProvider, run, type Agent, type AgentEvent, type Settings } from '../../src/common.js';

const PROMPT =
  'You are a patient receptionist at a developer conference. ' +
  'Keep replies to one or two short sentences. Never use markdown or emoji.';

// How many annoyed turns before FrustrationDetected says escalated.
const FRUSTRATION_LIMIT: number | null = 2;

// What the agent does once the caller has had enough. UpdatePrompt adds this to
// the prompt the agent already has, so it holds only the new lines.
const RECOVERY =
  'The caller is frustrated. Say sorry once, stop asking questions, ' +
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
        provider: { type: 'deepgram', version: 'v1', frustration_max_count: FRUSTRATION_LIMIT },
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
    if (event.escalated === true && !recovered) {
      recovered = true;
      agent.updatePrompt(RECOVERY);
    }
  }
}

if (isMain(import.meta.url)) await run({ buildSettings, onEvent });
