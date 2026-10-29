// Every place this project touches the Deepgram TypeScript SDK lives in this file.
//
// Missions import from here and never from '@deepgram/sdk' directly, so an SDK
// upgrade is a change to one file. What it gives a mission:
//
//   run({ buildSettings, onEvent })  connect, send your Settings, print the transcript,
//                                    let you type turns, save the agent's voice to a WAV
//   Agent                            the senders a mission needs: updatePrompt,
//                                    injectAgentMessage, functionCallResponse, ...
//   agent.sendRaw(json)              the escape hatch for JSON the SDK doesn't type
//   listenProvider()                 the listen model every mission uses (LISTEN_MODEL in .env)
//
// Events reach onEvent as plain objects shaped like the wire JSON, whether the
// SDK types them or not. Compare on event.type.

import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { DeepgramClient, type Deepgram } from '@deepgram/sdk';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROD_AGENT_URL = 'wss://agent.deepgram.com';
const AGENT_PATH = '/v1/agent/converse';
const KEEPALIVE_MS = 5000;
/** WebSocket pings: one unanswered ends the run (1006), as Python's and Java's 20 s pings do. */
const PING_MS = 20000;
/** How long a piped line waits for its reply before the next one goes. */
const PIPED_REPLY_MS = 30000;
export const HUNG_UP_LINE = '[bye] your program hung up.';
export const NO_AUDIO_LINE = '[no audio] The agent sent no audio on this call, so there is no new out/last-call.wav.';

/** The Settings message without its `type`; run() adds it. Cast for fields the SDK doesn't type. */
export type Settings = Omit<Deepgram.agent.AgentV1Settings, 'type'>;
/** Any event from the agent, as wire JSON. */
export type AgentEvent = { type: string; [field: string]: unknown };
export type BuildSettings = () => Settings;
export type OnEvent = (agent: Agent, event: AgentEvent) => void | Promise<void>;

type Socket = Awaited<ReturnType<DeepgramClient['agent']['v1']['connect']>>;

/**
 * A problem the attendee can fix (missing key, bad URL). Printed without a stack trace.
 * `retryable` is true when trying again later can help (the network dropped, or the
 * server was busy), and false when something has to change first (a refused key).
 */
export class SetupError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Printing errors safely: nothing printed may carry a key or a request header
// ---------------------------------------------------------------------------

const AUTH_HEADER = /(['"]?authorization['"]?\s*[:=]\s*['"]?)[^'",}\n]*/gi;
const AUTH_VALUE = /\b(token|bearer)(\s+)[A-Za-z0-9._~+/=-]{12,}/gi;
const AUTH_HEADER_LINE = /(\bauthorization header:[ \t]*)[^\n]*/gi;

/**
 * Mask anything that looks like a credential: the configured key and token,
 * an Authorization header in any form, and `Token ...` / `Bearer ...` values.
 */
export function redact(text: string): string {
  let out = text;
  for (const name of ['DEEPGRAM_API_KEY', 'WORKSHOP_TOKEN']) {
    const secret = process.env[name]?.trim();
    if (secret && secret.length >= 8) out = out.split(secret).join('[redacted]');
  }
  return out
    .replace(AUTH_HEADER_LINE, '$1[redacted]')
    .replace(AUTH_HEADER, '$1[redacted]')
    .replace(AUTH_VALUE, '$1$2[redacted]');
}

/** One printable description of a thrown value: its stack (or message), redacted. Never its other fields. */
export function describeError(err: unknown, { stack = false } = {}): string {
  if (err instanceof Error) return redact(stack && err.stack ? err.stack : `${err.name}: ${err.message}`);
  return redact(String(err));
}

let strayHandlers = false;

/**
 * Print a stray error (an SDK promise nobody awaits) redacted, then exit 1, as run() does.
 * Without this, Node prints every field of an uncaught error (util.inspect), and the SDK's
 * detached connect promise skips run()'s catch. For run() and runResilient() only.
 */
export function exitOnStrayErrors(): void {
  if (strayHandlers) return;
  strayHandlers = true;
  const fatal = (err: unknown): void => {
    console.error(describeError(err, { stack: true }));
    process.exit(1);
  };
  process.on('uncaughtException', fatal);
  process.on('unhandledRejection', fatal);
}

// ---------------------------------------------------------------------------
// Configuration: keys and URLs come from the environment or ../.env
// ---------------------------------------------------------------------------

/** Read .env in the voice-agent-workshop folder. Variables already set in the shell win. */
export function loadEnv(): void {
  loadDotenv({ path: join(PROJECT_ROOT, '.env'), quiet: true });
}

// Loaded on import, so a mission's module-level settings (THINKING_MODEL, say)
// see .env too. runAsync() loads it again; the shell still wins.
loadEnv();

// What DEEPGRAM_AGENT_URL or WORKSHOP_URL must look like, the same pattern body in common.py,
// Credentials.java and the harness (tools/parity/addresses.json): ws:// or wss://, a host, an
// optional port from 1 to 65535, then printable ASCII only. Checked before connecting, so a typo
// is one line, never a stray SyntaxError that prints the address.
const ADDRESS = new RegExp(
  String.raw`^(?:wss?://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+)(?::([0-9]{1,5}))?(?:[/?#][\x21-\x7E]*)?)$`,
);
export const BAD_AGENT_URL =
  "DEEPGRAM_AGENT_URL isn't a valid address. Copy it again, or leave it empty for Deepgram production.";
export const BAD_WORKSHOP_URL =
  "WORKSHOP_URL isn't a valid address. Copy it again from the workshop's /code page.";

/** True when `url` is an address the SDK can open. The WHATWG URL parser backs the pattern up. */
export function validAddress(url: string): boolean {
  const m = ADDRESS.exec(url);
  if (!m || (m[2] !== undefined && !(Number(m[2]) >= 1 && Number(m[2]) <= 65535))) return false;
  try {
    new URL(url);
  } catch {
    return false;
  }
  return true;
}

/** DEEPGRAM_AGENT_URL may be a host or the full converse URL. The SDK adds the path itself. */
export function agentBaseUrl(raw: string | undefined): string {
  let url = (raw || PROD_AGENT_URL).trim().replace(/\/+$/, '');
  if (url.endsWith(AGENT_PATH)) url = url.slice(0, -AGENT_PATH.length);
  // The value stays out of the message: it can name an endpoint that belongs out of logs.
  if (!/^wss?:\/\//.test(url)) throw new SetupError('DEEPGRAM_AGENT_URL must start with wss:// (or ws:// for the local check harness). Leave it empty for Deepgram production.');
  if (!validAddress(url)) throw new SetupError(BAD_AGENT_URL); // the value stays out of this one too
  return url;
}

/** The mission folder a file lives in ("00-first-words"), or undefined. */
export function missionOf(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const name = basename(dirname(resolve(path)));
  return /^\d{2}-[a-z0-9-]+$/.test(name) ? name : undefined;
}

/**
 * WORKSHOP_URL (the `wss://<host>/sdk` the /code page shows) plus the mission
 * folder. The SDK adds /v1/agent/converse, and the proxy logs the conversation
 * under that mission on your map.
 */
export function workshopBaseUrl(raw: string | undefined, mission?: string): string {
  let url = (raw ?? '').trim().replace(/\/+$/, '');
  if (!url) throw new SetupError("WORKSHOP_TOKEN is set but WORKSHOP_URL is empty. Copy both lines from the workshop's /code page into .env.");
  url = url.replace(/^https:/, 'wss:').replace(/^http:/, 'ws:');
  if (url.endsWith(AGENT_PATH)) url = url.slice(0, -AGENT_PATH.length);
  if (!/^wss?:\/\//.test(url)) throw new SetupError("WORKSHOP_URL must start with wss://. Copy it again from the workshop's /code page.");
  if (!validAddress(url)) throw new SetupError(BAD_WORKSHOP_URL);
  // The site's own address (no /sdk) reaches no proxy, which reads like a closed one.
  if (!url.endsWith('/sdk')) throw new SetupError(`WORKSHOP_URL should end in /sdk. Copy both lines from ${codePage()} into .env.`);
  return mission ? `${url}/${mission}` : url;
}

const env = (name: string): string => process.env[name]?.trim() ?? '';

/**
 * True when WORKSHOP_TOKEN and WORKSHOP_URL are both set and DEEPGRAM_AGENT_URL is
 * not: the run uses the workshop token, even with a DEEPGRAM_API_KEY in the shell
 * (one exported for your own STT work, say). Leave WORKSHOP_TOKEN empty to use your key.
 */
export function tokenWins(): boolean {
  return Boolean(env('WORKSHOP_TOKEN') && env('WORKSHOP_URL') && !env('DEEPGRAM_AGENT_URL'));
}

/**
 * True when this run goes through the workshop proxy, as in makeClient: WORKSHOP_TOKEN
 * set, no explicit `apiKey` or `url`, no DEEPGRAM_AGENT_URL, and either WORKSHOP_URL set
 * (the token wins) or no DEEPGRAM_API_KEY.
 */
export function usesWorkshop(apiKey?: string, url?: string): boolean {
  if (apiKey || url || env('DEEPGRAM_AGENT_URL') || !env('WORKSHOP_TOKEN')) return false;
  return tokenWins() || !env('DEEPGRAM_API_KEY');
}

// The listen model. nova-3 (v1) runs on every Deepgram project, and it's the model
// the Voice Agent docs show. The workshop site runs flux-general-en (v2), Deepgram's
// conversational listener with turn detection built in, and the workshop proxy only
// accepts that one. Set LISTEN_MODEL=flux-general-en and LISTEN_VERSION=v2 in .env to
// match the site on your own key.
export const DEFAULT_LISTEN_MODEL = 'nova-3';
export const DEFAULT_LISTEN_VERSION = 'v1';
export const WORKSHOP_LISTEN_MODEL = 'flux-general-en';
export const WORKSHOP_LISTEN_VERSION = 'v2';

/**
 * The `agent.listen.provider` block for missions that don't pick their own.
 * LISTEN_MODEL and LISTEN_VERSION override it. With a workshop token and no
 * override, it asks for the proxy's model, so no listen Warning comes back.
 */
export function listenProvider(): { type: 'deepgram'; model: string; version?: string } {
  let model = process.env.LISTEN_MODEL?.trim() ?? '';
  let version = process.env.LISTEN_VERSION?.trim() ?? '';
  if (!model) {
    const workshop = usesWorkshop();
    model = workshop ? WORKSHOP_LISTEN_MODEL : DEFAULT_LISTEN_MODEL;
    version ||= workshop ? WORKSHOP_LISTEN_VERSION : DEFAULT_LISTEN_VERSION;
  }
  return version ? { type: 'deepgram', model, version } : { type: 'deepgram', model };
}

/**
 * The workshop site's address (https://<host>/<path>), read from WORKSHOP_URL without its
 * /sdk (and anything after it) or a pasted page's /code, /resume or /m/<mission>, or undefined.
 * A ws:// or http:// WORKSHOP_URL (a local server) keeps http://.
 */
export function workshopSite(): string | undefined {
  const m = /^(wss|ws|https|http):\/\/([^/\s?#]+(?:\/[^\s?#]*)?)/.exec(process.env.WORKSHOP_URL?.trim() ?? '');
  if (!m) return undefined;
  const path = m[2].replace(/\/+$/, '').replace(/\/sdk(?:\/.*)?$/, '').replace(/\/(?:m\/.*|code|resume)$/, '');
  return `${m[1] === 'ws' || m[1] === 'http' ? 'http' : 'https'}://${path}`;
}

/** Where to get a workshop token: the site's /code page, by address when we know it. */
export function codePage(): string {
  const site = workshopSite();
  return site ? `${site}/code` : "the workshop site's /code page";
}

/** HTTP 401 through the workshop proxy: the proxy is open, but this token isn't valid. */
export function tokenRefusedHint(): string {
  return `Check WORKSHOP_TOKEN: it expired, was replaced, or was turned off by workshop staff. Get a new one on ${codePage()}.`;
}

/**
 * HTTP 404 through the workshop proxy: the token route itself is gone. The proxy runs
 * on event day only, so after the event every token gets this, not a 401.
 */
export const PROXY_CLOSED_HINT =
  'The workshop proxy is closed: it runs on event day only. Put your own DEEPGRAM_API_KEY ' +
  'in .env (free key: https://console.deepgram.com/signup) and leave WORKSHOP_TOKEN empty. ' +
  'Missions 01 and 02 use the `timing` feature: finish them with the offline check ' +
  '(make check 01), or on a Deepgram project that has the `timing` feature.';

/** 429 (busy) and 5xx (a server problem) can pass on a later try; other refusals can't. */
export function retryableStatus(status: number | undefined): boolean {
  return status !== undefined && (status === 429 || status >= 500);
}

/**
 * With no .env at all (make setup creates one): the same line as common.py and Credentials.java.
 * README "Troubleshooting" keys on the first words of both lines.
 */
export const NO_CREDENTIALS =
  'No Deepgram credentials. Copy .env.example to .env and set DEEPGRAM_API_KEY ' +
  "(free key: https://console.deepgram.com/signup), or paste WORKSHOP_URL and WORKSHOP_TOKEN from the workshop's /code page.";

/** True when the project's .env is there to edit. */
export function dotenvExists(): boolean {
  return existsSync(join(PROJECT_ROOT, '.env'));
}

/**
 * The line for a run with neither a key nor a token, by whether .env exists: the file
 * `make setup` created with an empty key is the usual case, so that one says "empty",
 * never "copy". `mission` (the folder) fills in the mission number; `hasEnv` (tests)
 * stands in for the file check.
 */
export function noCredentialsLine(mission?: string, hasEnv: boolean = dotenvExists()): string {
  const nn = mission ? mission.slice(0, 2) : 'NN';
  if (hasEnv) {
    // "this folder": the project folder, where make runs (the README says so, next to this line).
    return (
      'DEEPGRAM_API_KEY is empty in .env (this folder). Set it, or paste WORKSHOP_URL and WORKSHOP_TOKEN ' +
      `from the workshop's /code page. make check ${nn} runs offline with no key.`
    );
  }
  return NO_CREDENTIALS;
}

/**
 * The no-credentials line when there is neither a key (`apiKey` or DEEPGRAM_API_KEY) nor
 * a WORKSHOP_TOKEN, else undefined. Checks only whether they are set, never their values.
 */
export function credentialsProblem(apiKey?: string, mission?: string): string | undefined {
  const key = apiKey || process.env.DEEPGRAM_API_KEY?.trim();
  const token = process.env.WORKSHOP_TOKEN?.trim();
  return key || token ? undefined : noCredentialsLine(mission);
}

/** True when every character is printable ASCII (0x21 to 0x7E): no spaces, no curly quotes. */
export function printable(value: string): boolean {
  return /^[\x21-\x7e]*$/.test(value);
}

/**
 * A value that starts with a quote is a .env line whose quote never closed, or had words after
 * it: dotenv keeps the quote mark (", ' or `) in the value. A header can't carry it, and the line
 * names the fix.
 */
export function quoted(value: string): boolean {
  return /^['"`]/.test(value);
}

/** The line for a key or token with a character it can't have. Never prints the value. */
export function badCharacter(name: string, what: string): string {
  return (
    `${name} has a character ${what} can't have (a curly quote or a hidden space, ` +
    'often from copy and paste). Copy it again as plain text.'
  );
}

/**
 * One line saying which credential this run uses, when DEEPGRAM_API_KEY and
 * WORKSHOP_TOKEN are both set (a key exported in the shell or a Codespaces secret sets
 * one without .env saying so). Never prints either value.
 */
export function credentialsNote(): string | undefined {
  if (!env('DEEPGRAM_API_KEY') || !env('WORKSHOP_TOKEN')) return undefined;
  if (tokenWins()) {
    return (
      '[credentials] Using your workshop token (the proxy); your DEEPGRAM_API_KEY is set too ' +
      'and waits for after the event. To run on it now, leave WORKSHOP_TOKEN empty.'
    );
  }
  const why = env('DEEPGRAM_AGENT_URL') ? 'DEEPGRAM_AGENT_URL is set' : 'WORKSHOP_URL is empty';
  return `[credentials] Using your DEEPGRAM_API_KEY; your workshop token is not used because ${why}.`;
}

/**
 * An SDK client pointed at the right agent host with the right credentials.
 * Order: an explicit apiKey; then the workshop token when WORKSHOP_TOKEN and
 * WORKSHOP_URL are both set (sent as a bearer token, see tokenWins); then
 * DEEPGRAM_API_KEY; then WORKSHOP_TOKEN. Through the proxy, `mission` (the mission
 * folder) picks where your conversation counts. An explicit `url` (the local check
 * harness) gets the same credential; the harness relays it on.
 */
export function makeClient(url?: string, apiKey?: string, mission?: string): DeepgramClient {
  const token = env('WORKSHOP_TOKEN');
  const key = apiKey || (tokenWins() ? '' : env('DEEPGRAM_API_KEY'));
  // The workshop token belongs to the workshop proxy only. (An explicit `url` is
  // the local check harness, which relays to the proxy itself.)
  if (!key && token && !url && env('DEEPGRAM_AGENT_URL')) {
    throw new SetupError(
      'DEEPGRAM_AGENT_URL needs your own DEEPGRAM_API_KEY. With a workshop token, leave DEEPGRAM_AGENT_URL empty: ' +
        'the workshop proxy picks the endpoint.',
    );
  }
  // A workshop token and no agent URL: go through the workshop proxy.
  const base = usesWorkshop(apiKey, url)
    ? workshopBaseUrl(process.env.WORKSHOP_URL, mission)
    : agentBaseUrl(url || process.env.DEEPGRAM_AGENT_URL);
  const problem = credentialsProblem(apiKey, mission);
  if (problem) throw new SetupError(problem);
  // Printable ASCII only, and no leading quote: a header can't carry a curly quote, a space is a paste error,
  // and a quote is a .env line that never closed (Python and Java drop such a line and say so; dotenv keeps it).
  if (key && (!printable(key) || quoted(key))) throw new SetupError(badCharacter('DEEPGRAM_API_KEY', 'a key'));
  if (!key && (!printable(token) || quoted(token))) throw new SetupError(badCharacter('WORKSHOP_TOKEN', 'a token'));
  // The SDK replaces the whole environment object, so every URL is set here.
  const environment = {
    base: 'https://api.deepgram.com',
    production: 'wss://api.deepgram.com',
    agent: base,
    agentRest: base.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:'),
  };
  return key ? new DeepgramClient({ apiKey: key, environment }) : new DeepgramClient({ accessToken: token, environment });
}

// ---------------------------------------------------------------------------
// Errors worth explaining
// ---------------------------------------------------------------------------

/**
 * One line for a connection that failed before Settings applied. An HTTP refusal
 * reads like the Python helper's ("... refused the connection (HTTP 401).") and
 * carries a fix; the status comes only from the upgrade response, never from
 * other digits in the message (a port, say).
 */
export function connectFailure(message: string, workshop: boolean, code?: string): string {
  const status = /Unexpected server response: (\d{3})/.exec(message)?.[1];
  if (!status) {
    // Node's AggregateError (one error per address tried) has an empty message: read its code.
    const variable = workshop ? 'WORKSHOP_URL' : 'DEEPGRAM_AGENT_URL';
    if (code === 'ECONNREFUSED' || /ECONNREFUSED/.test(message)) {
      return `Could not reach the agent: connection refused. Check ${variable}.${workshop ? ' Is the workshop site up?' : ''}`;
    }
    // Node's message names the host or the address (getaddrinfo ENOTFOUND <host>): the line
    // says what happened in Java's words, or the error code alone, never the message.
    const what = code ?? /\bE[A-Z0-9_]{3,}\b/.exec(message)?.[0];
    let detail = what ?? 'the connection failed';
    if (what === 'ENOTFOUND' || what === 'EAI_AGAIN') detail = 'no such host';
    else if (what === 'ETIMEDOUT' || /\btime(?:d ?)?out\b/i.test(message)) detail = 'it timed out';
    return `Could not reach the agent: ${detail}. Check ${variable}.`;
  }
  let hint = '';
  if (status === '401') hint = workshop ? ` ${tokenRefusedHint()}` : ' Check DEEPGRAM_API_KEY.';
  else if (status === '404' && workshop) hint = ` ${PROXY_CLOSED_HINT}`;
  return `${workshop ? 'The workshop proxy' : 'Deepgram'} refused the connection (HTTP ${status}).${hint}`;
}

/** connectFailure as a SetupError, retryable for a network error, a 429 or a 5xx. */
export function connectError(message: string, workshop: boolean, code?: string): SetupError {
  const status = /Unexpected server response: (\d{3})/.exec(message)?.[1];
  return new SetupError(connectFailure(message, workshop, code), status ? retryableStatus(Number(status)) : true);
}

/** The error code of a socket error, or of the first error inside an AggregateError. */
export function errorCode(err: unknown): string | undefined {
  const e = err as { code?: unknown; errors?: Array<{ code?: unknown }> } | null;
  const code = e?.code ?? e?.errors?.find((x) => x?.code)?.code;
  return typeof code === 'string' ? code : undefined;
}

const SETTINGS_REFUSED_HINT =
  "The agent didn't accept part of your Settings. If this mission uses a feature your " +
  "Deepgram project can't use (01 and 02 use `timing`), finish it with the offline check " +
  '(make check and the mission number), or run it on a project that has the feature. ' +
  'On event day, a workshop token works too (WORKSHOP_URL and WORKSHOP_TOKEN in .env).';

/**
 * The agent's Error when the Deepgram project already runs as many `thinking` conversations
 * at once as it may. Through the workshop proxy, that's the workshop's project.
 */
export const CONCURRENCY_LIMIT_REACHED = 'CONCURRENCY_LIMIT_REACHED';
export const THINKING_BUSY_HINT =
  "The `thinking` model is busy: this Deepgram project (the workshop's, with a token) already " +
  'runs as many `thinking` conversations at once as it may. Wait a minute and run your program ' +
  'again, or leave THINKING_MODEL empty in .env to keep going with the usual model.';

/**
 * A Warning the `thinking` model's endpoint sends on every Settings: it put its own voice style
 * instructions ahead of your prompt. Expected, so it prints as a note, not a warning.
 */
export const VOICE_PROMPT_ADDED = 'VOICE_PROMPT_ADDED';
export const VOICE_PROMPT_NOTE =
  "[note] The `thinking` model put its own voice style instructions ahead of your prompt. " +
  "That's expected; nothing to change. (VOICE_PROMPT_ADDED)";

/*
 * The workshop proxy refuses a session it can't run with one Error before Welcome, then
 * closes 1013. The description says what to do; these are the same words, for a frame
 * that comes without one. A staff pause mid-run is a TALK_PAUSED Warning, then close 1000.
 */
export const TALK_UNCONFIGURED = 'TALK_UNCONFIGURED';
export const TALK_PAUSED = 'TALK_PAUSED';
export const ONLINE_FULL = 'ONLINE_FULL';
export const LIVE_CLOSED = 'LIVE_CLOSED';
export const TALK_MESSAGES: Readonly<Record<string, string>> = {
  [TALK_UNCONFIGURED]:
    "The workshop's live agent opens soon. Run your program again once it does, or set " +
    'DEEPGRAM_API_KEY in .env and leave WORKSHOP_TOKEN empty to run on your own key now.',
  [TALK_PAUSED]: 'Workshop staff paused the live agent for a minute. Run your program again shortly.',
  [ONLINE_FULL]: "The live agent's online seats are all taken right now. Wait a few minutes, then run your program again.",
  [LIVE_CLOSED]:
    "The workshop's live agent has closed. Your program runs on your own key now: set " +
    'DEEPGRAM_API_KEY and leave WORKSHOP_TOKEN empty.',
};
export const REFUSAL_CODES: ReadonlySet<string> = new Set(Object.keys(TALK_MESSAGES));

/**
 * Codes after which reconnecting can't help: the workshop stopped this token or session
 * on purpose. runResilient stops on them (see docs/troubleshooting.md).
 */
export const STOP_CODES: ReadonlySet<string> = new Set([
  ...REFUSAL_CODES, 'TOKEN_REPLACED', 'TOKEN_EXPIRED', 'TOKEN_REVOKED', 'SESSION_REPLACED',
  'SESSION_RESUMED', 'SESSION_CLOSED_BY_STAFF', 'SESSION_LIFETIME',
]);

/** The one line for a refusal or a pause: the proxy's own words and the code. */
export function workshopLine(event: AgentEvent): string {
  const code = String(event.code);
  const text = String(event.description || event.message || TALK_MESSAGES[code] || '');
  return `[workshop] ${text} (${code})`;
}

/** One readable line for an Error event, with a fix where we know one. */
export function explainError(event: AgentEvent): string {
  const code = String(event.code ?? 'no code');
  if (STOP_CODES.has(code)) return workshopLine(event);
  const text = String(event.description ?? event.message ?? '');
  let line = `Agent error: ${text} (${code})`;
  if (code === 'UNPARSABLE_CLIENT_MESSAGE') line += `\n  ${SETTINGS_REFUSED_HINT}`;
  else if (code === CONCURRENCY_LIMIT_REACHED) line += `\n  ${THINKING_BUSY_HINT}`;
  return line;
}

/**
 * One readable line for a Warning event, with its code when it has one
 * (TOKEN_REPLACED, SESSION_RESUMED, AUDIO_DROPPED, FEATURE_OFF: see docs/troubleshooting.md).
 * VOICE_PROMPT_ADDED is expected with `thinking`: a note.
 */
export function explainWarning(event: AgentEvent): string {
  if (event.code === VOICE_PROMPT_ADDED) return VOICE_PROMPT_NOTE;
  // The workshop stopped this token or session (a pause, a new token, a resume): its own line.
  if (STOP_CODES.has(String(event.code))) return workshopLine(event);
  const text = String(event.description ?? event.message ?? '');
  return event.code ? `Agent warning: ${text} (${String(event.code)})` : `Agent warning: ${text}`;
}

// ---------------------------------------------------------------------------
// The agent handle missions get
// ---------------------------------------------------------------------------

export class Agent {
  /** The Settings you sent, as JSON. */
  settings: Record<string, unknown> | null = null;
  ready = false;
  closed = false;
  /** True when your program called close(). */
  hungUp = false;
  /** How the connection closed (1006: no close frame, the network dropped), once it has. */
  closeCode: number | null = null;
  closeReason = '';
  /** A STOP_CODES code from an Error or Warning, if one came. */
  stopCode: string | null = null;
  /** Which frame carried stopCode: 'Error' or 'Warning'. */
  stopType: 'Error' | 'Warning' | null = null;
  /**
   * A piped turn with a function call: the client-side calls still waiting for your
   * FunctionCallResponse, and the lines you injected meanwhile (a filler). The turn ends
   * after the agent's first other line once you've answered, never on a filler's audio.
   */
  callsOpen = 0;
  injected: string[] = [];

  constructor(private readonly socket: Socket) {}

  /**
   * Send any JSON message as is, for fields or values the SDK doesn't type.
   * It goes straight to the SDK's underlying socket, so no typed sender is involved.
   */
  sendRaw(message: { type: string; [field: string]: unknown }): void {
    this.socket.socket.send(JSON.stringify(message));
  }

  sendSettings(settings: Settings): void {
    const message = { type: 'Settings' as const, ...settings };
    this.settings = message as unknown as Record<string, unknown>;
    this.socket.sendSettings(message);
  }

  updatePrompt(prompt: string): void {
    this.socket.sendUpdatePrompt({ type: 'UpdatePrompt', prompt });
  }

  updateSpeak(speak: Deepgram.agent.AgentV1UpdateSpeak['speak']): void {
    this.socket.sendUpdateSpeak({ type: 'UpdateSpeak', speak });
  }

  /** Swap the think block mid-call (provider, prompt, functions). Any JSON passes: the SDK serializes it as is. */
  updateThink(think: Deepgram.agent.AgentV1UpdateThink['think'] | Record<string, unknown>): void {
    this.socket.sendUpdateThink({ type: 'UpdateThink', think } as Deepgram.agent.AgentV1UpdateThink);
  }

  injectAgentMessage(message: string, behavior?: Deepgram.agent.AgentV1InjectAgentMessage['behavior']): void {
    this.injected.push(message.trim());
    this.socket.sendInjectAgentMessage({ type: 'InjectAgentMessage', message, ...(behavior ? { behavior } : {}) });
  }

  injectUserMessage(content: string): void {
    this.socket.sendInjectUserMessage({ type: 'InjectUserMessage', content });
  }

  functionCallResponse(id: string, name: string, content: string): void {
    this.callsOpen = Math.max(0, this.callsOpen - 1);
    this.socket.sendFunctionCallResponse({ type: 'FunctionCallResponse', id, name, content });
  }

  keepAlive(): void {
    this.socket.sendKeepAlive({ type: 'KeepAlive' });
  }

  sendAudio(chunk: ArrayBuffer | ArrayBufferView): void {
    this.socket.sendMedia(chunk);
  }

  /** Hang up. run() returns right after. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.hungUp = true;
    this.socket.close();
  }
}

// ---------------------------------------------------------------------------
// Audio: save the agent's voice to a WAV file
// ---------------------------------------------------------------------------

function writeWav(path: string, chunks: Buffer[], sampleRate: number): void {
  const data = Buffer.concat(chunks);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([header, data]));
}

// ---------------------------------------------------------------------------
// The conversation loop
// ---------------------------------------------------------------------------

// In an offline check every agent frame is a recording: an Error there is part of the
// scenario, sent on purpose to see how your program handles it.
export const REPLAY_ERROR_NOTE = '  [replay] The check sends this error on purpose, to see how your program handles it.';

/** Where typed turns come from: you type them ('tty'), or they're piped in ('piped'). */
export type InputMode = 'tty' | 'piped';

/** What the ready line says about typed turns, by where they come from. */
export const READY_HINTS: Readonly<Record<InputMode, string>> = {
  tty: ' Type a line and press Enter to talk. Ctrl-D or Ctrl-C hangs up.',
  piped: ' Reading your lines from the input; it hangs up after the reply to the last one.',
};

/**
 * What run() prints for an event, or undefined. `replay` marks lines from an offline check;
 * `typing` is the input mode the ready line describes (null: no typed turns).
 */
export function eventLine(event: AgentEvent, replay = false, typing: InputMode | null = 'tty'): string | undefined {
  let line: string | undefined;
  // An empty line (no greeting set, say) says nothing worth printing.
  if (event.type === 'ConversationText') {
    if (String(event.content ?? '').trim()) line = `${event.role}: ${event.content}`;
  } else if (event.type === 'Error') line = explainError(event) + (replay ? `\n${REPLAY_ERROR_NOTE}` : '');
  else if (event.type === 'Warning') line = explainWarning(event);
  else if (event.type === 'SettingsApplied') line = `[ready] the agent has your settings.${replay || !typing ? '' : READY_HINTS[typing]}`;
  return line !== undefined && replay ? `[replay] ${line}` : line;
}

function printEvent(event: AgentEvent, replay: boolean, typing: InputMode | null): void {
  const line = eventLine(event, replay, typing);
  if (line !== undefined) console.log(line);
}

export interface RunOptions {
  buildSettings: BuildSettings;
  onEvent?: OnEvent;
  /** Agent URL; defaults to DEEPGRAM_AGENT_URL, then production. */
  url?: string;
  /** Defaults to DEEPGRAM_API_KEY. */
  apiKey?: string;
  /**
   * Read typed turns from stdin, from a terminal or a pipe (the end of the input hangs up).
   * Defaults to true; the checks pass false.
   */
  interactive?: boolean;
  /** Save the agent's voice here as a WAV file. */
  saveAudio?: string | null;
  quiet?: boolean;
  /** The mission folder ("00-first-words"); through the workshop proxy, where the conversation counts. */
  mission?: string;
  /** An offline check: printed lines say they come from a recording. */
  replay?: boolean;
  /** Tests only: how often a WebSocket ping goes out. */
  pingMs?: number;
}

type RawWs = { readyState: number; ping(): void; terminate(): void; on(e: 'pong', fn: () => void): void };

/**
 * The `ws` socket under the SDK's, for pings. TEMPORARY WORKAROUND: the pinned
 * @deepgram/sdk 5.14.0 socket has no ping. The only touch of the private `_ws`;
 * common.test.ts pins it (if the SDK renames it, pings stop and that test fails).
 */
function rawSocket(socket: Socket): RawWs | undefined {
  return (socket.socket as unknown as { _ws?: RawWs })._ws;
}

/** Connect, send Settings when the server says Welcome, and hand every event to onEvent until the connection closes. */
export async function runAsync(opts: RunOptions): Promise<Agent> {
  loadEnv();
  const client = makeClient(opts.url, opts.apiKey, opts.mission);
  const typing: InputMode | null = opts.interactive === false ? null : process.stdin.isTTY ? 'tty' : 'piped';
  const audio: Buffer[] = [];
  let sampleRate = 24000;
  // reconnectAttempts 0: a dropped call should end the run, not open a second conversation.
  const socket = await client.agent.v1.connect({ reconnectAttempts: 0 });
  const agent = new Agent(socket);
  let failure: SetupError | null = null;
  let chain: Promise<void> = Promise.resolve();
  // A [bye] line is out already (the end of input, or Ctrl-C).
  let saidBye = false;

  const handle = async (message: unknown): Promise<void> => {
    if (message instanceof Blob) {
      audio.push(Buffer.from(await message.arrayBuffer()));
      return;
    }
    if (!message || typeof message !== 'object') return;
    const event = message as AgentEvent;
    if ((event.type === 'Error' || event.type === 'Warning') && STOP_CODES.has(String(event.code))) {
      agent.stopCode = String(event.code);
      agent.stopType = event.type;
    }
    if (event.type === 'Welcome') {
      const settings = opts.buildSettings();
      sampleRate = Number((settings.audio as { output?: { sample_rate?: number } })?.output?.sample_rate ?? 24000);
      // The greeting plays first: the first piped line waits for it to finish.
      if (typing === 'piped' && String((settings.agent as { greeting?: unknown } | undefined)?.greeting ?? '').trim()) startTurn('greeting');
      agent.sendSettings(settings);
    } else if (event.type === 'SettingsApplied') {
      agent.ready = true;
    }
    // A function call in a piped turn: the turn ends on the reply after your answer.
    if (event.type === 'FunctionCallRequest' && (turn === 'sent' || turn === 'spoken' || turn === 'calling')) {
      const fns = Array.isArray(event.functions) ? (event.functions as Array<{ client_side?: boolean }>) : [];
      const calls = fns.filter((f) => f?.client_side !== false).length;
      if (calls) {
        agent.callsOpen += calls;
        turn = 'calling';
      }
    }
    if (!opts.quiet) printEvent(event, Boolean(opts.replay), typing);
    await opts.onEvent?.(agent, event);
    if (event.type === 'SettingsApplied') pump();
    else if (event.type === 'ConversationText' && event.role === 'assistant' && (turn === 'sent' || (turn === 'calling' && !agent.callsOpen && !agent.injected.includes(String(event.content ?? '').trim())))) turn = 'spoken';
    else if (event.type === 'AgentAudioDone' && (turn === 'greeting' || turn === 'spoken')) endTurn();
  };

  // Typed turns. From a terminal each line goes as you press Enter; piped lines go one
  // at a time, each after the reply to the one before. The end of the input hangs up.
  const pending: string[] = [];
  let inputEnded = false;
  // Piped turns: the agent turn in flight. 'greeting': the greeting's audio; 'sent': a
  // piped line, no reply yet; 'calling': a function call is out (see Agent.callsOpen); 'spoken':
  // its reply came, its audio is still going. The turn ends on its own AgentAudioDone, or after PIPED_REPLY_MS.
  let turn: 'greeting' | 'sent' | 'calling' | 'spoken' | null = null;
  let replyTimer: ReturnType<typeof setTimeout> | undefined;
  const endTurn = (): void => {
    turn = null;
    clearTimeout(replyTimer);
    pump();
  };
  function startTurn(kind: 'greeting' | 'sent'): void {
    turn = kind;
    clearTimeout(replyTimer);
    replyTimer = setTimeout(endTurn, PIPED_REPLY_MS);
  }
  // The server can close before the 'close' event marks the agent closed (a pause, say).
  const open = (): boolean => !agent.closed && socket.readyState === 1;
  const send = (line: string): boolean => {
    if (!open()) return false;
    try {
      agent.injectUserMessage(line);
      return true;
    } catch {
      return false; // closed between the check and the send: nothing left to send
    }
  };
  function pump(): void {
    if (!agent.ready || !open()) return;
    if (typing === 'tty') {
      while (pending.length) if (!send(pending.shift()!)) return;
    } else if (turn === null && pending.length) {
      startTurn('sent');
      agent.callsOpen = 0;
      agent.injected = [];
      if (!send(pending.shift()!)) return;
    }
    if (inputEnded && !pending.length && turn === null) {
      if (!opts.quiet) console.log('[bye] end of input, hanging up.');
      saidBye = true;
      agent.close();
    }
  }
  // The first error your onEvent (or buildSettings) throws. The call hangs up and
  // runAsync rethrows it once the socket has closed, as the Python helper does.
  let thrown = null as { err: unknown } | null;
  const done = new Promise<void>((resolveDone) => {
    socket.on('message', (message) => {
      // Keep events in order even when onEvent is async. After a throw, nothing more runs.
      chain = chain
        .then(() => (thrown ? undefined : handle(message)))
        .catch((err) => {
          thrown ??= { err };
          agent.close();
        });
    });
    socket.on('error', (err) => {
      if (!agent.ready) failure = connectError(String(err.message ?? ''), usesWorkshop(opts.apiKey, opts.url), errorCode(err));
      // After Settings applied, an error mid-call still gets one line, redacted like the rest.
      else console.error(`[socket error] ${redact(String(err.message))}`);
    });
    socket.on('close', (event) => {
      agent.closed = true;
      agent.closeCode = event.code;
      agent.closeReason = String(event.reason ?? '') || (event.code === 1006 ? 'no close frame' : '');
      // A stop code already printed its line; the close after it says nothing new.
      const said = agent.stopCode !== null;
      if (!opts.quiet && event.code !== 1000 && event.code !== 1005 && agent.ready && !said) {
        console.log(`[closed] ${event.code} ${agent.closeReason}`.trimEnd());
      }
      // Your program hung up (end_call answered, say): one closing line, so the run
      // doesn't look like it stopped on its own.
      if (!opts.quiet && !opts.replay && agent.hungUp && !saidBye && !thrown) console.log(HUNG_UP_LINE);
      resolveDone();
    });
  });

  // Ctrl-C hangs up cleanly, so the agent's voice still gets saved.
  const onSigint = () => {
    if (!opts.quiet) console.log('\n[bye]');
    saidBye = true;
    agent.close();
  };
  process.once('SIGINT', onSigint);
  // A ping every PING_MS; one still unanswered at the next means the network is gone.
  let awaitingPong = false;
  socket.on('open', () => rawSocket(socket)?.on('pong', () => {
    awaitingPong = false;
  }));
  const ping = setInterval(() => {
    const ws = rawSocket(socket);
    if (!ws || ws.readyState !== 1) return;
    if (awaitingPong) return ws.terminate();
    awaitingPong = true;
    ws.ping();
  }, opts.pingMs ?? PING_MS);
  socket.connect();
  const keepAlive = setInterval(() => {
    if (agent.ready && !agent.closed) agent.keepAlive();
  }, KEEPALIVE_MS);
  const rl = typing ? createInterface({ input: process.stdin }) : null;
  rl?.on('line', (line) => {
    const text = line.trim();
    if (!text || agent.closed) return;
    pending.push(text);
    pump();
  });
  rl?.on('close', () => {
    inputEnded = true;
    pump();
  });

  try {
    await done;
    await chain;
  } finally {
    clearInterval(keepAlive);
    clearInterval(ping);
    clearTimeout(replyTimer);
    process.off('SIGINT', onSigint);
    rl?.close();
    if (opts.saveAudio && audio.length) {
      writeWav(opts.saveAudio, audio, sampleRate);
      if (!opts.quiet) console.log(`[saved] the agent's voice is in ${relative(PROJECT_ROOT, opts.saveAudio)}`);
    } else if (opts.saveAudio && agent.ready && !opts.quiet) console.log(NO_AUDIO_LINE);
  }
  if (thrown) throw thrown.err;
  if (failure) throw failure;
  return agent;
}

/** Entry point: `pnpm tsx missions/NN-name/start.ts [--no-save]`. */
export async function run(opts: Pick<RunOptions, 'buildSettings' | 'onEvent'>): Promise<void> {
  exitOnStrayErrors();
  const save = process.argv.includes('--no-save') ? null : join(PROJECT_ROOT, 'out', 'last-call.wav');
  loadEnv();
  const note = credentialsNote();
  if (note) console.log(note);
  try {
    const agent = await runAsync({ ...opts, saveAudio: save, mission: missionOf(process.argv[1]) });
    process.exit(exitStatus(agent));
  } catch (err) {
    if (err instanceof SetupError) {
      console.error(err.message);
      process.exit(2);
    }
    // Not rethrown: Node would print every field of the error object, and SDK errors can carry request headers.
    console.error(describeError(err, { stack: true }));
    process.exit(1);
  }
}

/**
 * The program's exit status: 1 when the workshop refused the session (an Error with
 * TALK_UNCONFIGURED, TALK_PAUSED, ONLINE_FULL or LIVE_CLOSED), else 0. A staff pause
 * mid-run (a TALK_PAUSED Warning) ends the run cleanly, with 0.
 */
export function exitStatus(agent: Pick<Agent, 'stopCode' | 'stopType'>): number {
  return agent.stopType === 'Error' && agent.stopCode !== null && REFUSAL_CODES.has(agent.stopCode) ? 1 : 0;
}

/**
 * True when this module was started directly (`tsx start.ts`), not imported by a test.
 * Compares real paths, so a checkout reached through a symlink, or a Windows drive
 * letter in another case, still counts as started directly.
 */
export function isMain(metaUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  if (!argv1) return false;
  const real = (path: string): string => {
    try {
      return realpathSync.native(path);
    } catch {
      return path;
    }
  };
  const self = real(fileURLToPath(metaUrl));
  const started = real(resolve(argv1));
  return process.platform === 'win32' ? self.toLowerCase() === started.toLowerCase() : self === started;
}
