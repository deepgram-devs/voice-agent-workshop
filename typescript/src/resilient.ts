// Keep a conversation going when the connection drops: runResilient in place of run.
//
// A dropped connection on a train or a hotel network ends run() for good. This one
// reconnects with a growing wait (1 s, 2 s, 4 s ... up to 15 s, with a little jitter)
// and sends your Settings again on every new connection, because the agent knows
// nothing until Settings arrive. Each close code it sees is printed, so you can tell
// a network drop (1006) from a server problem (1011) or a restart (1012).
//
// It tries again only when trying again can help:
//
//   reconnects   no close frame (1006), server error (1011), restart (1012),
//                try again later (1013), bad gateway (1014), a network error,
//                HTTP 429 or 5xx on connect
//   stops        you hung up (agent.close()), a clean close (1000), any other close,
//                a refused key or token (401), a closed workshop proxy (404), or a
//                workshop stop code (TALK_UNCONFIGURED, TALK_PAUSED, ONLINE_FULL,
//                LIVE_CLOSED, TOKEN_*, SESSION_REPLACED ...)
//
// A reconnect starts a new conversation: the agent doesn't remember the old one.
//
//   import { runResilient } from '../../src/resilient.js';
//   if (isMain(import.meta.url)) await runResilient({ buildSettings, onEvent });

import { join } from 'node:path';
import {
  Agent,
  PROJECT_ROOT,
  SetupError,
  credentialsNote,
  describeError,
  exitOnStrayErrors,
  exitStatus,
  loadEnv,
  missionOf,
  runAsync,
  type RunOptions,
} from './common.js';

export const RETRY_CLOSE_CODES = new Set([1006, 1011, 1012, 1013, 1014]);
export const MAX_ATTEMPTS = 5;
const BASE_DELAY_S = 1;
const MAX_DELAY_S = 15;

/** Seconds to wait before attempt `attempt + 1`: doubles each time, capped, plus up to 25% jitter. */
export function backoff(attempt: number, base = BASE_DELAY_S, cap = MAX_DELAY_S): number {
  const delay = Math.min(cap, base * 2 ** (attempt - 1));
  return delay + Math.random() * (delay / 4);
}

/** True when the call ended in a way a new connection can fix. */
export function shouldReconnect(agent: Agent): boolean {
  return !agent.hungUp && agent.stopCode === null && agent.closeCode !== null && RETRY_CLOSE_CODES.has(agent.closeCode);
}

export interface ResilientOptions extends RunOptions {
  maxAttempts?: number;
  /** How to wait between attempts, in seconds. Tests pass one that doesn't. */
  sleep?: (seconds: number) => Promise<void>;
  log?: (line: string) => void;
}

const wait = (seconds: number) => new Promise<void>((r) => setTimeout(r, seconds * 1000));

/** runAsync with reconnects. Resolves with the last conversation's Agent. */
export async function runResilientAsync(opts: ResilientOptions): Promise<Agent> {
  const { maxAttempts = MAX_ATTEMPTS, sleep = wait, log = console.log, ...runOptions } = opts;
  for (let attempt = 1; ; attempt++) {
    let pause: number;
    try {
      const agent = await runAsync(runOptions);
      if (!shouldReconnect(agent)) return agent;
      const closed = `${agent.closeCode} ${agent.closeReason}`.trim();
      if (attempt >= maxAttempts) {
        log(`[reconnect] closed ${closed}; giving up after ${attempt} attempts.`);
        return agent;
      }
      pause = backoff(attempt);
      log(`[reconnect] closed ${closed}; trying again in ${pause.toFixed(1)} s (attempt ${attempt + 1} of ${maxAttempts}).`);
    } catch (err) {
      if (!(err instanceof SetupError) || !err.retryable || attempt >= maxAttempts) throw err;
      pause = backoff(attempt);
      log(`[reconnect] ${err.message} Trying again in ${pause.toFixed(1)} s (attempt ${attempt + 1} of ${maxAttempts}).`);
    }
    await sleep(pause);
  }
}

/** Entry point like common.run: `pnpm tsx missions/NN-name/start.ts [--no-save]`, with reconnects. */
export async function runResilient(opts: Pick<RunOptions, 'buildSettings' | 'onEvent'>): Promise<void> {
  exitOnStrayErrors();
  const save = process.argv.includes('--no-save') ? null : join(PROJECT_ROOT, 'out', 'last-call.wav');
  loadEnv();
  const note = credentialsNote();
  if (note) console.log(note);
  try {
    const agent = await runResilientAsync({ ...opts, saveAudio: save, mission: missionOf(process.argv[1]) });
    process.exit(exitStatus(agent));
  } catch (err) {
    if (err instanceof SetupError) {
      console.error(err.message);
      process.exit(2);
    }
    console.error(describeError(err, { stack: true }));
    process.exit(1);
  }
}
