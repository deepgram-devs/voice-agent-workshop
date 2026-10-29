// Mission 01, Let me finish: an agent that waits while you talk, and hangs up when you say goodbye.
//
// Run it:    pnpm tsx missions/01-let-me-finish/solution.ts
// Check it:  make check 01      (offline, no key)
// Live:      make live 01       (real API; needs the timing feature, see the README)
//
// Reference solution. Try start.ts first.

import { isMain, listenProvider, run, type Agent, type AgentEvent, type Settings } from '../../src/common.js';

const PROMPT =
  "You are a patient receptionist taking down a caller's phone number. " +
  'Keep replies to one short sentence. When the caller says goodbye or has ' +
  'nothing else to add, call end_call straight away, before you say anything.';
const VOICE = 'flux-hannah-en';
const GREETING = "Hi, you've reached the front desk. Would you like to leave a number?";

// The timing knobs. Real wire names; the feature key is `timing`.
const BACKCHANNEL = 0.3; // 0 to 1: how readily it says "mm-hm" instead of taking the turn
const PRESENCE_INTERVAL_MS = 4000; // silence before it asks whether you're still there
const PRESENCE_MAX = 2; // how many times it asks. It never hangs up by itself.

// Hearing: the speech-to-text model (LISTEN_MODEL in .env picks another).
const LISTEN = listenProvider();

// Declared in Settings, so the agent can ask your code to end the call.
const END_CALL = {
  name: 'end_call',
  description: 'End the phone call. Call this once the caller has said goodbye and has nothing else to add.',
  parameters: { type: 'object', properties: {} },
};

// One call's state. A new call starts at Welcome.
const call = { hangUpPending: false };

/** The Settings message: sent once, as soon as the server says Welcome. */
export function buildSettings(): Settings {
  const agent: Record<string, unknown> = {
    listen: { provider: LISTEN },
    think: {
      provider: { type: 'open_ai', model: 'gpt-4o-mini' },
      prompt: PROMPT,
      functions: [END_CALL],
    },
    speak: { provider: { type: 'deepgram', model: VOICE, version: 'v2' } },
    greeting: GREETING,
  };
  // The timing block.
  agent.think_live = {
    provider: {
      type: 'deepgram',
      version: 'v1',
      agent_backchannel_sensitivity: BACKCHANNEL,
      presence_check_interval_ms: PRESENCE_INTERVAL_MS,
      presence_check_max_count: PRESENCE_MAX,
    },
  };
  return {
    audio: {
      input: { encoding: 'linear16', sample_rate: 16000 },
      output: { encoding: 'linear16', sample_rate: 24000, container: 'none' },
    },
    agent,
  } as Settings;
}

type FunctionRequest = { id: string; name: string };

/** Every event from the agent lands here. */
export async function onEvent(agent: Agent, event: AgentEvent): Promise<void> {
  if (event.type === 'Welcome') {
    call.hangUpPending = false;
  } else if (event.type === 'FunctionCallRequest') {
    for (const fn of (event.functions as FunctionRequest[] | undefined) ?? []) {
      if (fn.name === 'end_call') {
        agent.functionCallResponse(fn.id, 'end_call', 'The call is ending. Say a short goodbye.');
        call.hangUpPending = true;
      }
    }
  } else if (event.type === 'AgentAudioDone' && call.hangUpPending) {
    // The goodbye has finished playing: now hang up.
    console.log('[hang up] the agent said goodbye');
    agent.close();
  }
}

if (isMain(import.meta.url)) await run({ buildSettings, onEvent });
