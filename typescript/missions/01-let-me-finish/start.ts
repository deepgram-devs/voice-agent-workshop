// Mission 01, Let me finish: an agent that waits while you talk, and hangs up when you say goodbye.
//
// Run it:    make run 01   (or, from typescript/: pnpm tsx missions/01-let-me-finish/start.ts)
//            needs DEEPGRAM_API_KEY or your workshop token in .env; in Docker: docker compose run --rm workshop make run 01
// Check it:  make check 01     (offline, no key)
// Live:      make live 01      (real API: needs DEEPGRAM_API_KEY or your workshop token in .env; the timing feature too, see the README)
//
// Four TODOs below. The brief is in ../../../missions/01-let-me-finish/README.md.

import { isMain, listenProvider, run, type Agent, type AgentEvent, type Settings } from '../../src/common.js';

const PROMPT =
  "You are a patient receptionist taking down a caller's phone number. " +
  'Keep replies to one short sentence. When the caller says goodbye or has ' +
  'nothing else to add, call end_call straight away, before you say anything.';
const VOICE = 'flux-hannah-en';
const GREETING = "Hi, you've reached the front desk. Would you like to leave a number?";

// The timing knobs, under their wire names (the fields as the API spells them); the feature key is `timing`.
const BACKCHANNEL = 0.3; // 0 to 1: how readily it says "mm-hm" instead of taking the turn
const PRESENCE_INTERVAL_MS = 4000; // silence before it asks whether you're still there
const PRESENCE_MAX = 2; // how many times it asks. It never hangs up by itself.

// Hearing: the speech-to-text model (LISTEN_MODEL in .env picks another).
const LISTEN = listenProvider();

// TODO 2 (TODO 1 is below, in buildSettings()): end_call is the function the agent calls to
// ask your code to end the call. Its `name` and `parameters` are written; fill in the
// `description`: write one sentence: when should the model call it?
const END_CALL = {
  name: 'end_call',
  description: '',
  parameters: { type: 'object', properties: {} }, // a JSON Schema: this function takes no arguments
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
  // TODO 1: Turn on timing: add the block below to agent (select the lines and press Cmd-/ or Ctrl-/).
  // agent.think_live = {
  //   provider: {
  //     type: 'deepgram',
  //     version: 'v1',
  //     agent_backchannel_sensitivity: BACKCHANNEL,
  //     presence_check_interval_ms: PRESENCE_INTERVAL_MS,
  //     presence_check_max_count: PRESENCE_MAX,
  //   },
  // };
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
        // TODO 3: Answer it, then remember that a hang-up is pending. Each fn has an id.
        // agent.functionCallResponse(fn.id, 'end_call', '<any short text>');
        // call.hangUpPending = true;
      }
    }
  }

  // TODO 4: The agent says goodbye after your answer, and never hangs up on
  // its own. When an AgentAudioDone arrives and a hang-up is pending, the
  // goodbye has finished playing: print why the run ended, then close.
  // (Nothing to await: the helpers' agent.* calls return at once.)
  // if (event.type === 'AgentAudioDone' && call.hangUpPending) {
  //   console.log('[hang up] the agent said goodbye');
  //   agent.close();
  // }
}

if (isMain(import.meta.url)) await run({ buildSettings, onEvent });
