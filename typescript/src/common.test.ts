// Unit tests for the shared helpers. `make ci` runs them (`make unit`).
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Agent,
  BAD_AGENT_URL,
  BAD_WORKSHOP_URL,
  PROJECT_ROOT,
  SetupError,
  agentBaseUrl,
  connectFailure,
  errorCode,
  describeError,
  makeClient,
  explainError,
  explainWarning,
  THINKING_BUSY_HINT,
  VOICE_PROMPT_NOTE,
  exitStatus,
  isMain,
  NO_CREDENTIALS,
  noCredentialsLine,
  REPLAY_ERROR_NOTE,
  STOP_CODES,
  TALK_MESSAGES,
  credentialsNote,
  credentialsProblem,
  eventLine,
  missionOf,
  redact,
  runAsync,
  usesWorkshop,
  validAddress,
  workshopBaseUrl,
  codePage,
  type Settings,
} from './common.js';
import { countingServer } from './counting-server.js';

const FAKE_KEY = '0123456789abcdef0123456789abcdef01234567';
// Test characters are built from code points, so this file stays ASCII.
const LQ = String.fromCodePoint(0x201c); // curly quotes, as a chat or a doc pastes them
const RQ = String.fromCodePoint(0x201d);
const saved = process.env.DEEPGRAM_API_KEY;
afterEach(() => {
  if (saved === undefined) delete process.env.DEEPGRAM_API_KEY;
  else process.env.DEEPGRAM_API_KEY = saved;
});

describe('redact', () => {
  it('masks the configured key', () => {
    process.env.DEEPGRAM_API_KEY = FAKE_KEY;
    expect(redact(`failed with ${FAKE_KEY} in it`)).not.toContain(FAKE_KEY);
  });

  it('masks Authorization headers in any shape', () => {
    delete process.env.DEEPGRAM_API_KEY;
    for (const text of [
      `headers: {'Authorization': 'Token ${FAKE_KEY}', 'X-Fern': 'x'}`,
      `{"authorization": "Bearer ${FAKE_KEY}"}`,
      `Authorization: token ${FAKE_KEY}`,
      `sent Token ${FAKE_KEY}`,
    ]) {
      const out = redact(text);
      expect(out).not.toContain(FAKE_KEY);
      expect(out).toContain('[redacted]');
    }
  });
});

describe('redact: the invalid Authorization header line', () => {
  it('masks the rest of the line, and only that line', () => {
    process.env.DEEPGRAM_API_KEY = '';
    expect(redact(`invalid Authorization header: Token ${LQ}abc${RQ}`)).toBe('invalid Authorization header: [redacted]');
    expect(redact(`invalid Authorization header: Bearer ${LQ}wst_abc${RQ}`)).toBe('invalid Authorization header: [redacted]');
    // A message that ends in the header name: the next line is something else, and stays.
    expect(redact('invalid Authorization header:\nToken shown')).toBe('invalid Authorization header:[redacted]\nToken shown');
    expect(redact('invalid Authorization header:\nBearer shown')).toBe('invalid Authorization header:[redacted]\nBearer shown');
  });
});

describe('describeError', () => {
  it('uses the message (or stack), never other fields of the error', () => {
    delete process.env.DEEPGRAM_API_KEY;
    const err = Object.assign(new Error('Unexpected server response: 401'), { headers: { Authorization: `Token ${FAKE_KEY}` } });
    expect(describeError(err)).toBe('Error: Unexpected server response: 401');
    expect(describeError(err, { stack: true })).not.toContain(FAKE_KEY);
    expect(describeError(new Error(`bad Token ${FAKE_KEY}`))).not.toContain(FAKE_KEY);
  });
});

describe('the workshop proxy path', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('adds the mission folder to WORKSHOP_URL and takes https', () => {
    expect(workshopBaseUrl('https://speak.example.test/sdk/', '00-first-words')).toBe('wss://speak.example.test/sdk/00-first-words');
    expect(workshopBaseUrl('ws://localhost:8080/sdk/v1/agent/converse')).toBe('ws://localhost:8080/sdk');
    expect(() => workshopBaseUrl('', '00-first-words')).toThrow(/WORKSHOP_URL is empty/);
  });

  it('says WORKSHOP_URL should end in /sdk, and keeps http for a local server', () => {
    process.env.WORKSHOP_URL = 'http://localhost:8103';
    expect(() => workshopBaseUrl('http://localhost:8103', '00-first-words')).toThrow(
      /^WORKSHOP_URL should end in \/sdk\. Copy both lines from http:\/\/localhost:8103\/code into \.env\.$/,
    );
    process.env.WORKSHOP_URL = 'ws://localhost:8103/sdk';
    expect(codePage()).toBe('http://localhost:8103/code');
    process.env.WORKSHOP_URL = 'wss://speak.example.test/sdk';
    expect(codePage()).toBe('https://speak.example.test/code');
  });

  it('reads the mission folder from a file path', () => {
    expect(missionOf('/x/typescript/missions/04-polyglot/start.ts')).toBe('04-polyglot');
    expect(missionOf('/x/typescript/src/common.ts')).toBeUndefined();
    expect(missionOf(undefined)).toBeUndefined();
  });

  it('uses WORKSHOP_TOKEN over a key in the shell once WORKSHOP_URL is set too', () => {
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.DEEPGRAM_AGENT_URL;
    delete process.env.WORKSHOP_URL;
    process.env.WORKSHOP_TOKEN = `wst_${'a'.repeat(43)}`;
    expect(usesWorkshop()).toBe(true);
    process.env.DEEPGRAM_API_KEY = FAKE_KEY;
    expect(usesWorkshop()).toBe(false); // a key and no WORKSHOP_URL: the key
    process.env.WORKSHOP_URL = 'wss://speak.example.test/sdk';
    expect(usesWorkshop()).toBe(true); // a key, a token and WORKSHOP_URL: the token
    process.env.WORKSHOP_TOKEN = '';
    expect(usesWorkshop()).toBe(false); // WORKSHOP_TOKEN empty: your key
  });

  it('leaves the proxy out when an agent URL is set, as makeClient does', () => {
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.DEEPGRAM_AGENT_URL;
    process.env.WORKSHOP_TOKEN = `wst_${'a'.repeat(43)}`;
    expect(usesWorkshop(undefined, 'ws://127.0.0.1:9')).toBe(false);
    process.env.DEEPGRAM_AGENT_URL = 'wss://agent.example.test';
    expect(usesWorkshop()).toBe(false);
  });

  it('never sends a workshop token to DEEPGRAM_AGENT_URL', () => {
    delete process.env.DEEPGRAM_API_KEY;
    process.env.WORKSHOP_TOKEN = `wst_${'a'.repeat(43)}`;
    process.env.WORKSHOP_URL = 'wss://speak.example.test/sdk';
    process.env.DEEPGRAM_AGENT_URL = 'wss://agent.hidden.example.test';
    const refused = () => makeClient(undefined, undefined, '00-first-words');
    expect(refused).toThrow(SetupError);
    expect(refused).toThrow(/^DEEPGRAM_AGENT_URL needs your own DEEPGRAM_API_KEY\./);
    expect(refused).not.toThrow(/hidden|wst_/);
    // The check harness passes its own url; the token goes to it, as before.
    expect(() => makeClient('ws://127.0.0.1:9')).not.toThrow();
    // With a key of your own, DEEPGRAM_AGENT_URL is yours to set.
    process.env.DEEPGRAM_API_KEY = FAKE_KEY;
    expect(() => makeClient()).not.toThrow();
  });

  it('names a bad URL without echoing it', () => {
    expect(() => agentBaseUrl('agent.hidden.example.test')).toThrow(/^DEEPGRAM_AGENT_URL must start with wss:\/\/[^]*production\.$/);
    expect(() => workshopBaseUrl('speak.hidden.example.test/sdk', '00-first-words')).toThrow(/^WORKSHOP_URL must start with wss:\/\//);
    for (const bad of [() => agentBaseUrl('agent.hidden.example.test'), () => workshopBaseUrl('speak.hidden.example.test/sdk')]) {
      expect(bad).toThrow(SetupError);
      expect(bad).not.toThrow(/hidden/);
    }
  });
});

describe('Agent.sendRaw', () => {
  it('writes the JSON to the SDK socket as is, with no typed sender involved', () => {
    const sent: string[] = [];
    const socket = { socket: { send: (data: string) => sent.push(data) } };
    const agent = new Agent(socket as unknown as ConstructorParameters<typeof Agent>[0]);
    agent.sendRaw({ type: 'UpdateThink', think: { provider: { type: 'deepgram', model: 'x' } } });
    expect(sent.map((s) => JSON.parse(s))).toEqual([{ type: 'UpdateThink', think: { provider: { type: 'deepgram', model: 'x' } } }]);
  });
});

// A server that answers every WebSocket upgrade with HTTP 401.
async function refusingServer(): Promise<{ server: Server; port: number }> {
  const server = createServer();
  server.on('upgrade', (_req, socket) => socket.end('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n'));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { server, port: (server.address() as AddressInfo).port };
}

describe('connectFailure', () => {
  it('reads the status from the upgrade response only, and gives each status its fix', () => {
    expect(connectFailure('Unexpected server response: 404', true)).toMatch(
      /^The workshop proxy refused the connection \(HTTP 404\)\. The workshop proxy is closed: it runs on event day only\. Put your own DEEPGRAM_API_KEY/,
    );
    expect(connectFailure('Unexpected server response: 404', false)).toBe('Deepgram refused the connection (HTTP 404).');
    expect(connectFailure('Unexpected server response: 401', false)).toBe('Deepgram refused the connection (HTTP 401). Check DEEPGRAM_API_KEY.');
    // A port that happens to contain 401 or 404 is not a status.
    expect(connectFailure('connect ECONNREFUSED 127.0.0.1:54010', true)).toBe('Could not reach the agent: connection refused. Check WORKSHOP_URL. Is the workshop site up?');
    expect(connectFailure('connect ECONNREFUSED 127.0.0.1:40401', false)).not.toMatch(/HTTP/);
    // Node's AggregateError: an empty message, the code on the error (or its first inner one).
    expect(connectFailure('', true, 'ECONNREFUSED')).toBe('Could not reach the agent: connection refused. Check WORKSHOP_URL. Is the workshop site up?');
    expect(connectFailure('', false, 'ENOTFOUND')).toBe(
      'Could not reach the agent: no such host. Check DEEPGRAM_AGENT_URL.',
    );
    expect(errorCode(Object.assign(new AggregateError([Object.assign(new Error(''), { code: 'ECONNREFUSED' })], ''), {}))).toBe('ECONNREFUSED');
  });

  it("names what happened in Java's words, or the code alone, and never the host", () => {
    const line = (detail: string) => `Could not reach the agent: ${detail}. Check DEEPGRAM_AGENT_URL.`;
    const notFound = 'getaddrinfo ENOTFOUND agent.hidden.example.test';
    expect(connectFailure(notFound, false, 'ENOTFOUND')).toBe(line('no such host'));
    expect(connectFailure(notFound, false)).toBe(line('no such host'));
    expect(connectFailure('getaddrinfo EAI_AGAIN agent.hidden.example.test', false)).toBe(line('no such host'));
    expect(connectFailure('connect ETIMEDOUT 192.0.2.1:443', false)).toBe(line('it timed out'));
    expect(connectFailure('TIMEOUT', false)).toBe(line('it timed out'));
    expect(connectFailure('Opening handshake has timed out', false)).toBe(line('it timed out'));
    expect(connectFailure('connect EADDRNOTAVAIL 127.0.0.1 - Local (0.0.0.0:0)', false)).toBe(line('EADDRNOTAVAIL'));
    expect(connectFailure('no route to wss://agent.hidden.example.test', false)).toBe(line('the connection failed'));
    expect(connectFailure('', false)).toBe(line('the connection failed'));
  });
});

describe('runAsync', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  const quiet = { interactive: false, saveAudio: null, quiet: true } as const;

  it('turns a refused connection into a SetupError that never carries the key', async () => {
    delete process.env.WORKSHOP_TOKEN;
    delete process.env.DEEPGRAM_AGENT_URL;
    process.env.DEEPGRAM_API_KEY = FAKE_KEY;
    const { server, port } = await refusingServer();
    try {
      const err = await runAsync({ buildSettings: () => ({}) as Settings, url: `ws://127.0.0.1:${port}`, ...quiet }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SetupError);
      expect((err as Error).message).toBe('Deepgram refused the connection (HTTP 401). Check DEEPGRAM_API_KEY.');
      expect((err as Error).message).not.toContain(FAKE_KEY);
    } finally {
      server.close();
    }
  });

  it('with a workshop token, names the token without printing it', async () => {
    const token = `wst_${'b'.repeat(43)}`;
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.DEEPGRAM_AGENT_URL;
    process.env.WORKSHOP_TOKEN = token;
    const { server, port } = await refusingServer();
    process.env.WORKSHOP_URL = `ws://127.0.0.1:${port}/sdk`;
    try {
      const err = await runAsync({ buildSettings: () => ({}) as Settings, mission: '00-first-words', ...quiet }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SetupError);
      expect((err as Error).message).toMatch(/^The workshop proxy refused the connection \(HTTP 401\)\. Check WORKSHOP_TOKEN: .*turned off by workshop staff/);
      expect((err as Error).message).not.toContain(token);
    } finally {
      server.close();
    }
  });

  it('hangs up and rethrows when onEvent throws, and runs no more events after it', async () => {
    // The mission 00 replay plays the server side.
    const harness = spawn(process.execPath, [join(PROJECT_ROOT, 'tools', 'replay-server', 'harness.mjs'), 'replay', '00', 'greeting'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const url = await new Promise<string>((resolveUrl) => {
      createInterface({ input: harness.stdout! }).on('line', (l) => l.startsWith('READY ') && resolveUrl(l.slice(6)));
    });
    const boom = new Error('boom from onEvent');
    const after: string[] = [];
    let threw = false;
    const err = await runAsync({
      buildSettings: () => ({ agent: { greeting: 'Hi.' } }) as unknown as Settings,
      onEvent: (_agent, event) => {
        if (threw) after.push(event.type);
        if (event.type === 'SettingsApplied') {
          threw = true;
          throw boom;
        }
      },
      url,
      apiKey: 'replay-check-no-real-key',
      ...quiet,
    }).catch((e: unknown) => e);
    await new Promise((r) => harness.on('close', r));
    expect(err).toBe(boom);
    expect(after).toEqual([]);
  });
});

describe('thinking (VOICE_PROMPT_ADDED, CONCURRENCY_LIMIT_REACHED)', () => {
  it('prints the voice-prompt warning as a note', () => {
    const warning = { type: 'Warning', code: 'VOICE_PROMPT_ADDED', description: 'Voice style instructions were added ahead of your system prompt.' };
    expect(explainWarning(warning)).toBe(VOICE_PROMPT_NOTE);
    expect(VOICE_PROMPT_NOTE.startsWith('[note] ')).toBe(true);
    expect(VOICE_PROMPT_NOTE.endsWith('(VOICE_PROMPT_ADDED)')).toBe(true);
  });

  it('adds what to do to the concurrency-limit error, which is not a workshop stop', () => {
    const busy = { type: 'Error', code: 'CONCURRENCY_LIMIT_REACHED', description: 'Concurrency limit reached.' };
    expect(explainError(busy)).toBe(`Agent error: Concurrency limit reached. (CONCURRENCY_LIMIT_REACHED)\n  ${THINKING_BUSY_HINT}`);
    expect(THINKING_BUSY_HINT).toContain('THINKING_MODEL');
    expect(STOP_CODES.has('CONCURRENCY_LIMIT_REACHED')).toBe(false);
  });
});

describe('explainWarning', () => {
  it('carries the code when the warning has one', () => {
    expect(explainWarning({ type: 'Warning', code: 'AUDIO_DROPPED', description: 'Some audio was dropped.' })).toBe('Agent warning: Some audio was dropped. (AUDIO_DROPPED)');
    expect(explainWarning({ type: 'Warning', description: 'Heads up.' })).toBe('Agent warning: Heads up.');
  });

  it('prints the whole resume stop line with its code', () => {
    const line = "You picked up your saved progress on the workshop site, so this program's token stopped working. Get a new token on the /code page, put it in WORKSHOP_TOKEN, and run your program again.";
    expect(explainWarning({ type: 'Warning', code: 'SESSION_RESUMED', description: line })).toBe(`[workshop] ${line} (SESSION_RESUMED)`);
    expect(explainWarning({ type: 'Warning', code: 'TOKEN_REPLACED', description: 'You made a new token.' })).toBe('[workshop] You made a new token. (TOKEN_REPLACED)');
  });
});

describe('workshop refusals and the pause', () => {
  for (const code of ['TALK_UNCONFIGURED', 'TALK_PAUSED', 'ONLINE_FULL', 'LIVE_CLOSED']) {
    it(`prints ${code} as one line with its next step, and stops`, () => {
      expect(STOP_CODES.has(code)).toBe(true);
      expect(explainError({ type: 'Error', code, description: 'Run your program again shortly.' })).toBe(`[workshop] Run your program again shortly. (${code})`);
      // A frame without a description still says what to do.
      const bare = explainError({ type: 'Error', code });
      expect(bare).toBe(`[workshop] ${TALK_MESSAGES[code]} (${code})`);
      expect(bare).not.toContain('\n');
      expect(exitStatus({ stopCode: code, stopType: 'Error' })).toBe(1);
    });
  }

  it('prints the pause warning as one workshop line, and a pause mid-run exits cleanly', () => {
    expect(explainWarning({ type: 'Warning', code: 'TALK_PAUSED', description: 'Workshop staff paused the live agent for a minute.' })).toBe(
      '[workshop] Workshop staff paused the live agent for a minute. (TALK_PAUSED)',
    );
    expect(exitStatus({ stopCode: 'TALK_PAUSED', stopType: 'Warning' })).toBe(0);
    expect(exitStatus({ stopCode: null, stopType: null })).toBe(0);
    expect(exitStatus({ stopCode: 'TOKEN_REPLACED', stopType: 'Error' })).toBe(0);
  });
});

describe('replay lines, credentials', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('marks replayed lines, and says a replayed error is on purpose', () => {
    const err = { type: 'Error', code: 'INVALID_SETTINGS', description: "Voice Agent component 'speak' is not authorized." };
    const line = eventLine(err, true)!;
    expect(line.startsWith('[replay] Agent error: ')).toBe(true);
    expect(line.endsWith(REPLAY_ERROR_NOTE)).toBe(true);
    expect(eventLine(err)).toBe("Agent error: Voice Agent component 'speak' is not authorized. (INVALID_SETTINGS)");
    expect(eventLine({ type: 'SettingsApplied' }, true)).toBe('[replay] [ready] the agent has your settings.');
    expect(eventLine({ type: 'ConversationText', role: 'user', content: ' ' }, true)).toBeUndefined();
  });

  it('names missing credentials, and says which credential runs when both are set', () => {
    delete process.env.DEEPGRAM_API_KEY;
    delete process.env.WORKSHOP_TOKEN;
    delete process.env.DEEPGRAM_AGENT_URL;
    process.env.WORKSHOP_URL = 'wss://speak.example.test/sdk';
    expect(credentialsProblem()).toBe(noCredentialsLine());
    expect(credentialsProblem(undefined, '03-no-dead-air')).toBe(noCredentialsLine('03-no-dead-air'));
    expect(credentialsProblem('explicit-key')).toBeUndefined();
    // With no .env: copy it. With one (make setup's, key empty): set the key in it. Both name
    // the folder, the token lines, the /code page and the offline check with its number.
    const missing = noCredentialsLine('03-no-dead-air', false);
    expect(missing).toBe(NO_CREDENTIALS);
    expect(missing).toMatch(/^No Deepgram credentials\. Copy \.env\.example to \.env/);
    const empty = noCredentialsLine('03-no-dead-air', true);
    expect(empty).toBe(
      'DEEPGRAM_API_KEY is empty in .env (this folder). Set it, or paste WORKSHOP_URL and WORKSHOP_TOKEN ' +
        "from the workshop's /code page. make check 03 runs offline with no key.",
    );
    expect(empty).not.toContain('Copy');
    expect(noCredentialsLine(undefined, true)).toMatch(/make check NN runs offline with no key\.$/);
    expect(credentialsNote()).toBeUndefined();
    process.env.WORKSHOP_TOKEN = 'wst_unit-test-token';
    expect(credentialsProblem()).toBeUndefined();
    expect(credentialsNote()).toBeUndefined();
    process.env.DEEPGRAM_API_KEY = FAKE_KEY;
    expect(credentialsNote()).toBe(
      '[credentials] Using your workshop token (the proxy); your DEEPGRAM_API_KEY is set too and waits for after the event. To run on it now, leave WORKSHOP_TOKEN empty.',
    );
    process.env.WORKSHOP_URL = '';
    const note = credentialsNote()!;
    expect(note).toBe('[credentials] Using your DEEPGRAM_API_KEY; your workshop token is not used because WORKSHOP_URL is empty.');
    expect(note).not.toContain(FAKE_KEY);
    expect(note).not.toContain('wst_unit-test-token');
    process.env.DEEPGRAM_AGENT_URL = 'wss://agent.example.test';
    expect(credentialsNote()).toBe('[credentials] Using your DEEPGRAM_API_KEY; your workshop token is not used because DEEPGRAM_AGENT_URL is set.');
  });
});

describe('isMain', () => {
  it('matches the started file by its real path, through a symlinked folder too, and nothing else', () => {
    const dir = mkdtempSync(join(tmpdir(), 'is-main-'));
    try {
      mkdirSync(join(dir, 'real'));
      writeFileSync(join(dir, 'real', 'start.ts'), '');
      writeFileSync(join(dir, 'real', 'other.ts'), '');
      const url = pathToFileURL(join(dir, 'real', 'start.ts')).href;
      expect(isMain(url, join(dir, 'real', 'start.ts'))).toBe(true);
      expect(isMain(url, join(dir, 'real', 'other.ts'))).toBe(false);
      expect(isMain(url, undefined)).toBe(false);
      // A checkout reached through a symlink: Node's module URL is the real path, argv[1] isn't.
      symlinkSync(join(dir, 'real'), join(dir, 'link'), 'dir');
      expect(isMain(url, join(dir, 'link', 'start.ts'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

// ---- a key or token with a character a header can't carry ----------------------------

const MARKER = 'leakprobe0123456789abcdef';
const KEY_LINE =
  "DEEPGRAM_API_KEY has a character a key can't have (a curly quote or a hidden space, often from copy and paste). Copy it again as plain text.";
const TOKEN_LINE =
  "WORKSHOP_TOKEN has a character a token can't have (a curly quote or a hidden space, often from copy and paste). Copy it again as plain text.";
const GOOD_TOKEN = `wst_${'AZaz09-_'.repeat(6)}`;
const cp = (code: number): string => String.fromCodePoint(code);

/** Values a header can't carry, after trim(): each stops with the line. */
function badValues(value: string, short: string): [string, string][] {
  const mid = value.length / 2;
  const inner = (c: string) => value.slice(0, mid) + c + value.slice(mid);
  return [
    ['curly-quoted', LQ + value + RQ],
    ['short curly-quoted', LQ + short + RQ],
    ['inner no-break space', inner(cp(0xa0))],
    ['trailing zero-width space', value + cp(0x200b)],
    ['inner space', inner(' ')],
    ['inner tab', inner('\t')],
    ['trailing U+0085', value + cp(0x85)], // trim() keeps U+0085 and U+001C
    ['leading U+001C', cp(0x1c) + value],
  ];
}

/** All four credential variables ('' when unused), so a developer's .env can't fill one in. */
function setCredentials(values: Record<string, string>): void {
  for (const name of ['DEEPGRAM_API_KEY', 'DEEPGRAM_AGENT_URL', 'WORKSHOP_TOKEN', 'WORKSHOP_URL']) process.env[name] = values[name] ?? '';
}

/** process.env without DEEPGRAM_* or WORKSHOP_* values, all four credentials set ('' if unused). */
function cleanEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(process.env)) if (!/^(DEEPGRAM|WORKSHOP)_/.test(name)) env[name] = value;
  return { ...env, DEEPGRAM_API_KEY: '', DEEPGRAM_AGENT_URL: '', WORKSHOP_TOKEN: '', WORKSHOP_URL: '', ...values };
}

async function runNode(args: string[], env: NodeJS.ProcessEnv): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const child = spawn(process.execPath, ['--import', 'tsx', ...args], { cwd: join(PROJECT_ROOT, 'typescript'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout!.on('data', (d) => (stdout += d));
  child.stderr!.on('data', (d) => (stderr += d));
  const status = await new Promise<number | null>((r) => child.on('close', r));
  return { status, stdout, stderr };
}

function expectNeverPrinted(text: string): void {
  expect(text).not.toContain(MARKER);
  expect(text).not.toContain(LQ);
  expect(text).not.toContain(RQ);
  expect(text).not.toMatch(/^\s+at /m);
}

describe("a key or token with a character a header can't carry", () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  for (const [label, key] of badValues(FAKE_KEY, 'abc')) {
    it(`stops a key (${label}) before connecting, without printing it`, () => {
      setCredentials({ DEEPGRAM_API_KEY: key, DEEPGRAM_AGENT_URL: 'ws://127.0.0.1:9' });
      const err = (() => {
        try {
          makeClient();
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(SetupError);
      expect((err as SetupError).message).toBe(KEY_LINE);
      expect((err as SetupError).retryable).toBe(false);
      expect((err as SetupError).message).not.toContain(key.trim());
    });
  }

  for (const [label, token] of badValues(GOOD_TOKEN, 'wst_abc')) {
    it(`stops a token (${label}) before connecting, without printing it`, () => {
      setCredentials({ WORKSHOP_TOKEN: token, WORKSHOP_URL: 'ws://127.0.0.1:9/sdk' });
      const err = (() => {
        try {
          makeClient(undefined, undefined, '00-first-words');
        } catch (e) {
          return e;
        }
      })();
      expect(err).toBeInstanceOf(SetupError);
      expect((err as SetupError).message).toBe(TOKEN_LINE);
      expect((err as SetupError).retryable).toBe(false);
      expect((err as SetupError).message).not.toContain(token.trim());
    });
  }

  it('a value that starts with a quote (a .env line whose quote never closed, which dotenv keeps) stops with the line, never the value', () => {
    for (const value of [`"${MARKER}`, `'${MARKER}`, `\`${MARKER}`, `"${MARKER}" extra`]) {
      for (const [vars, line] of [
        [{ DEEPGRAM_API_KEY: value, DEEPGRAM_AGENT_URL: 'ws://127.0.0.1:9' }, KEY_LINE],
        [{ WORKSHOP_TOKEN: value, WORKSHOP_URL: 'wss://speak.example.test/sdk' }, TOKEN_LINE],
      ] as const) {
        setCredentials(vars);
        const err = (() => {
          try {
            makeClient(undefined, undefined, '00-first-words');
          } catch (e) {
            return e;
          }
        })();
        expect(err).toBeInstanceOf(SetupError);
        expect((err as SetupError).message).toBe(line);
        expectNeverPrinted((err as SetupError).message);
      }
    }
  });

  it('lets valid keys and tokens through', () => {
    // Edge whitespace from a paste is trimmed first (trim(): U+FEFF, U+00A0 and U+3000 too).
    for (const key of [FAKE_KEY, `  ${FAKE_KEY}${cp(0xa0)}\n`, cp(0xfeff) + FAKE_KEY, cp(0xa0) + FAKE_KEY + cp(0x3000)]) {
      setCredentials({ DEEPGRAM_API_KEY: key, DEEPGRAM_AGENT_URL: 'ws://127.0.0.1:9' });
      expect(() => makeClient()).not.toThrow();
    }
    for (const token of [GOOD_TOKEN, 'aaa.bbb.ccc']) {
      setCredentials({ WORKSHOP_TOKEN: token, WORKSHOP_URL: 'wss://speak.example.test/sdk' });
      expect(() => makeClient(undefined, undefined, '00-first-words')).not.toThrow();
    }
    // Only the credential actually sent is checked: an unused bad key never blocks the token...
    setCredentials({ DEEPGRAM_API_KEY: LQ + FAKE_KEY + RQ, WORKSHOP_TOKEN: GOOD_TOKEN, WORKSHOP_URL: 'wss://speak.example.test/sdk' });
    expect(() => makeClient(undefined, undefined, '00-first-words')).not.toThrow();
    // ...nor an explicit key (make check sends its replay key).
    setCredentials({ DEEPGRAM_API_KEY: LQ + FAKE_KEY + RQ });
    expect(() => makeClient('ws://127.0.0.1:9', 'replay-check-no-real-key')).not.toThrow();
  });

  it('makes runAsync reject with the line before the SDK client exists, so nothing connects and nothing hangs', async () => {
    const server = await countingServer();
    try {
      setCredentials({ DEEPGRAM_API_KEY: LQ + MARKER + RQ, DEEPGRAM_AGENT_URL: `ws://127.0.0.1:${server.port}` });
      const err = await runAsync({ buildSettings: () => ({}) as Settings, interactive: false, saveAudio: null, quiet: true }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(SetupError);
      expect((err as SetupError).message).toBe(KEY_LINE);
      expect((err as SetupError).retryable).toBe(false);
      expect(await server.connections()).toBe(0);
    } finally {
      server.close();
    }
  }, 10_000);

  for (const mode of ['key', 'token'] as const) {
    it(`make run 00 with a bad ${mode} prints exactly the line, exits 2 and never connects`, async () => {
      const server = await countingServer();
      try {
        const url = `ws://127.0.0.1:${server.port}`;
        const env =
          mode === 'key'
            ? cleanEnv({ DEEPGRAM_API_KEY: LQ + MARKER + RQ, DEEPGRAM_AGENT_URL: url })
            : cleanEnv({ WORKSHOP_TOKEN: `${LQ}wst_${MARKER}${RQ}`, WORKSHOP_URL: `${url}/sdk` });
        const run = await runNode([join('missions', '00-first-words', 'start.ts'), '--no-save'], env);
        expect(run.status, run.stdout + run.stderr).toBe(2);
        expect(run.stderr.trim()).toBe(mode === 'key' ? KEY_LINE : TOKEN_LINE);
        expectNeverPrinted(run.stdout + run.stderr);
        expect(await server.connections()).toBe(0);
      } finally {
        server.close();
      }
    }, 30_000);
  }

  it('prints a stray SDK error redacted and exits 1, not as Node prints an uncaught error', async () => {
    const server = await countingServer();
    const dir = mkdtempSync(join(tmpdir(), 'stray-error-'));
    try {
      const program = join(dir, 'stray.mts');
      writeFileSync(
        program,
        `import { run } from ${JSON.stringify(pathToFileURL(join(PROJECT_ROOT, 'typescript', 'src', 'common.ts')).href)};\n` +
          "process.argv.push('--no-save');\n" +
          // A promise nobody awaits, as the SDK's detached connect is.
          "Promise.reject(new Error('Authorization: Token ' + process.env.DEEPGRAM_API_KEY));\n" +
          'await run({ buildSettings: () => ({}) });\n',
      );
      const run = await runNode([program], cleanEnv({ DEEPGRAM_API_KEY: FAKE_KEY, DEEPGRAM_AGENT_URL: `ws://127.0.0.1:${server.port}` }));
      expect(run.status, run.stdout + run.stderr).toBe(1);
      expect(run.stderr).toContain('Error: Authorization: [redacted]');
      expect(run.stdout + run.stderr).not.toContain(FAKE_KEY);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);

  it('prints a stray SDK error redacted and exits 1 through runResilient too', async () => {
    const server = await countingServer();
    const dir = mkdtempSync(join(tmpdir(), 'stray-error-'));
    try {
      const program = join(dir, 'stray.mts');
      writeFileSync(
        program,
        `import { runResilient } from ${JSON.stringify(pathToFileURL(join(PROJECT_ROOT, 'typescript', 'src', 'resilient.ts')).href)};\n` +
          "process.argv.push('--no-save');\n" +
          // A promise nobody awaits, as the SDK's detached connect is.
          "Promise.reject(new Error('Authorization: Token ' + process.env.DEEPGRAM_API_KEY));\n" +
          'await runResilient({ buildSettings: () => ({}) });\n',
      );
      const run = await runNode([program], cleanEnv({ DEEPGRAM_API_KEY: FAKE_KEY, DEEPGRAM_AGENT_URL: `ws://127.0.0.1:${server.port}` }));
      expect(run.status, run.stdout + run.stderr).toBe(1);
      expect(run.stderr).toContain('Error: Authorization: [redacted]');
      expect(run.stdout + run.stderr).not.toContain(FAKE_KEY);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("an address that isn't one", () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });
  const table = JSON.parse(readFileSync(join(PROJECT_ROOT, 'tools', 'parity', 'addresses.json'), 'utf8')) as {
    valid: string[];
    invalid: string[];
    agent: [string, string | null][];
    workshop: [string, string | null][];
  };
  const thrown = (fn: () => unknown): unknown => {
    try {
      fn();
    } catch (e) {
      return e;
    }
    return undefined;
  };

  it('reads the shared table (tools/parity/addresses.json), as Python, Java and the harness do', () => {
    expect(table.valid.filter((u) => !validAddress(u))).toEqual([]);
    expect(table.invalid.filter((u) => validAddress(u))).toEqual([]);
    for (const [raw, want] of table.agent) {
      if (want === null) expect((thrown(() => agentBaseUrl(raw)) as Error)?.message, raw).toBe(BAD_AGENT_URL);
      else expect(agentBaseUrl(raw), raw).toBe(want);
    }
    for (const [raw, want] of table.workshop) {
      if (want === null) expect((thrown(() => workshopBaseUrl(raw)) as Error)?.message, raw).toBe(BAD_WORKSHOP_URL);
      else expect(workshopBaseUrl(raw), raw).toBe(want);
    }
  });

  it('makes runAsync reject with the line, not a stray SyntaxError, and nothing connects', async () => {
    const server = await countingServer();
    try {
      for (const url of ['ws://127.0.0.1:abc', `ws://127.0.0.1:${server.port}/a b`]) {
        setCredentials({ DEEPGRAM_API_KEY: MARKER, DEEPGRAM_AGENT_URL: url });
        const opts = { buildSettings: () => ({}) as Settings, interactive: false, saveAudio: null, quiet: true };
        const err = await runAsync(opts).catch((e: unknown) => e);
        expect(err).toBeInstanceOf(SetupError);
        expect((err as SetupError).message).toBe(BAD_AGENT_URL);
      }
      expect(await server.connections()).toBe(0);
    } finally {
      server.close();
    }
  }, 10_000);

  for (const mode of ['key', 'token'] as const) {
    it(`make run 00 with a bad ${mode} address prints exactly the line, exits 2 and never connects`, async () => {
      const server = await countingServer();
      try {
        for (const url of ['ws://127.0.0.1:abc', `ws://127.0.0.1:${server.port}/a b`]) {
          const env =
            mode === 'key'
              ? cleanEnv({ DEEPGRAM_API_KEY: MARKER, DEEPGRAM_AGENT_URL: url })
              : cleanEnv({ WORKSHOP_TOKEN: `wst_${MARKER}`, WORKSHOP_URL: `${url}/sdk` });
          const run = await runNode([join('missions', '00-first-words', 'start.ts'), '--no-save'], env);
          expect(run.status, run.stdout + run.stderr).toBe(2);
          expect(run.stderr.trim()).toBe(mode === 'key' ? BAD_AGENT_URL : BAD_WORKSHOP_URL);
          expectNeverPrinted(run.stdout + run.stderr);
          expect(run.stdout + run.stderr).not.toContain('127.0.0.1');
        }
        expect(await server.connections()).toBe(0);
      } finally {
        server.close();
      }
    }, 30_000);
  }
});

// The harness's `ws` (8.22.0), which can leave pings unanswered (autoPong: false).
type PingPeer = {
  send(data: string): void;
  close(code: number): void;
  on(e: string, fn: (d: Buffer) => void): void;
};
type PingServer = {
  on(e: 'connection', fn: (ws: PingPeer) => void): void;
  on(e: 'listening', fn: () => void): void;
  address(): AddressInfo;
  close(): void;
};
const harnessRequire = createRequire(join(PROJECT_ROOT, 'tools', 'replay-server', 'package.json'));
const { WebSocketServer: PingWebSocketServer } = harnessRequire('ws') as {
  WebSocketServer: new (opts: { host: string; port: number; autoPong: boolean }) => PingServer;
};

/** Welcome, then SettingsApplied on Settings, then `after` (or nothing at all). */
async function pingServer(autoPong: boolean, after?: (ws: PingPeer) => void): Promise<{ port: number; close(): void }> {
  const wss = new PingWebSocketServer({ host: '127.0.0.1', port: 0, autoPong });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'Welcome', request_id: 'ping-test' }));
    ws.on('message', (data) => {
      if (JSON.parse(data.toString()).type !== 'Settings') return;
      ws.send(JSON.stringify({ type: 'SettingsApplied' }));
      after?.(ws);
    });
  });
  await new Promise<void>((r) => wss.on('listening', r));
  return { port: wss.address().port, close: () => wss.close() };
}

describe('the WebSocket ping', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
    vi.restoreAllMocks();
  });

  it('ends the run as a drop when a server goes silent and a ping goes unanswered', async () => {
    const server = await pingServer(false);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      setCredentials({});
      const url = `ws://127.0.0.1:${server.port}`;
      const opts = { buildSettings: () => ({}) as Settings, url, apiKey: FAKE_KEY, interactive: false };
      const agent = await runAsync({ ...opts, saveAudio: null, pingMs: 300 });
      expect(agent.closeCode).toBe(1006);
      expect(agent.closeReason).toBe('no close frame');
      expect(log.mock.calls.flat()).toContain('[closed] 1006 no close frame');
    } finally {
      server.close();
    }
  }, 10_000);

  it('keeps the call while the server answers its pings', async () => {
    const server = await pingServer(true, (ws) => setTimeout(() => ws.close(1000), 1200));
    try {
      setCredentials({});
      const url = `ws://127.0.0.1:${server.port}`;
      const opts = { buildSettings: () => ({}) as Settings, url, apiKey: FAKE_KEY, interactive: false };
      const agent = await runAsync({ ...opts, saveAudio: null, pingMs: 300, quiet: true });
      expect(agent.closeCode).toBe(1000);
    } finally {
      server.close();
    }
  }, 10_000);
});
