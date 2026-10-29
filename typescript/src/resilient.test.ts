// Unit tests for the reconnect helper and the listen and refusal helpers. `make ci` runs them (`make unit`).
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { HUNG_UP_LINE, NO_AUDIO_LINE, PROJECT_ROOT, TALK_MESSAGES, connectError, connectFailure, codePage, listenProvider, workshopSite, type Settings } from './common.js';
import { backoff, runResilientAsync } from './resilient.js';

// The check harness's WebSocket server (make setup installs it) plays the agent.
// Typed here by hand: the TypeScript project doesn't depend on ws itself.
interface Peer {
  send(data: string): void;
  close(code: number, reason: string): void;
  terminate(): void;
  on(event: 'message', fn: (data: Buffer, isBinary: boolean) => void): void;
}
interface Server {
  once(event: 'listening', fn: () => void): void;
  on(event: 'connection', fn: (ws: Peer, req: { headers: Record<string, string | undefined> }) => void): void;
  address(): AddressInfo;
  close(): void;
}
const { WebSocketServer } = createRequire(join(PROJECT_ROOT, 'tools', 'replay-server', 'package.json'))('ws') as {
  WebSocketServer: new (opts: { host: string; port: number }) => Server;
};

const FAKE_KEY = '0123456789abcdef0123456789abcdef01234567';
const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

describe('listenProvider', () => {
  it('defaults to nova-3 v1 on your own key and follows LISTEN_MODEL / LISTEN_VERSION', () => {
    for (const name of ['LISTEN_MODEL', 'LISTEN_VERSION', 'WORKSHOP_TOKEN', 'DEEPGRAM_AGENT_URL']) delete process.env[name];
    process.env.DEEPGRAM_API_KEY = FAKE_KEY;
    expect(listenProvider()).toEqual({ type: 'deepgram', model: 'nova-3', version: 'v1' });
    process.env.LISTEN_MODEL = 'flux-general-en';
    process.env.LISTEN_VERSION = 'v2';
    expect(listenProvider()).toEqual({ type: 'deepgram', model: 'flux-general-en', version: 'v2' });
    delete process.env.LISTEN_VERSION;
    expect(listenProvider()).toEqual({ type: 'deepgram', model: 'flux-general-en' });
  });

  it("asks for the proxy's model with a workshop token", () => {
    for (const name of ['LISTEN_MODEL', 'LISTEN_VERSION', 'DEEPGRAM_API_KEY', 'DEEPGRAM_AGENT_URL']) delete process.env[name];
    process.env.WORKSHOP_TOKEN = `wst_${'a'.repeat(43)}`;
    expect(listenProvider()).toEqual({ type: 'deepgram', model: 'flux-general-en', version: 'v2' });
  });
});

describe('refusal lines', () => {
  it('names the code page from WORKSHOP_URL', () => {
    process.env.WORKSHOP_URL = 'wss://speak.example.test/sdk';
    expect(workshopSite()).toBe('https://speak.example.test');
    expect(codePage()).toBe('https://speak.example.test/code');
    process.env.WORKSHOP_URL = 'wss://speak.example.test/builders-lab/sdk/';
    expect(workshopSite()).toBe('https://speak.example.test/builders-lab');
    process.env.WORKSHOP_URL = 'https://speak.example.test/builders-lab/code';
    expect(codePage()).toBe('https://speak.example.test/builders-lab/code');
    process.env.WORKSHOP_URL = 'wss://speak.example.test/builders-lab/sdk/v1/agent/converse';
    expect(workshopSite()).toBe('https://speak.example.test/builders-lab');
    process.env.WORKSHOP_URL = 'wss://speak.example.test?x=1';
    expect(workshopSite()).toBe('https://speak.example.test');
    // A pasted mission page (or its step) or /resume names the site, not that page.
    process.env.WORKSHOP_URL = 'https://speak.example.test/builders-lab/m/first-words';
    expect(codePage()).toBe('https://speak.example.test/builders-lab/code');
    process.env.WORKSHOP_URL = 'https://speak.example.test/builders-lab/m/let-me-finish/the-knobs/';
    expect(workshopSite()).toBe('https://speak.example.test/builders-lab');
    process.env.WORKSHOP_URL = 'https://speak.example.test/resume';
    expect(workshopSite()).toBe('https://speak.example.test');
    process.env.WORKSHOP_URL = '';
    expect(codePage()).toBe("the workshop site's /code page");
  });

  it('tells a closed proxy (404) from a refused token (401)', () => {
    process.env.WORKSHOP_URL = 'wss://speak.example.test/sdk';
    const closed = connectFailure('Unexpected server response: 404', true);
    expect(closed).toMatch(/^The workshop proxy refused the connection \(HTTP 404\)\. The workshop proxy is closed/);
    expect(closed).toContain('make check 01');
    const token = connectFailure('Unexpected server response: 401', true);
    expect(token).toContain('Check WORKSHOP_TOKEN');
    expect(token).toContain('https://speak.example.test/code');
    expect(token).not.toContain('closed');
  });

  it('marks network errors, 429 and 5xx as worth another try', () => {
    expect(connectError('connect ECONNREFUSED 127.0.0.1:9', false).retryable).toBe(true);
    expect(connectError('Unexpected server response: 503', false).retryable).toBe(true);
    expect(connectError('Unexpected server response: 429', false).retryable).toBe(true);
    expect(connectError('Unexpected server response: 401', false).retryable).toBe(false);
    expect(connectError('Unexpected server response: 404', true).retryable).toBe(false);
  });
});

describe('backoff', () => {
  it('doubles and caps at 15 s, with up to 25% jitter', () => {
    for (const [attempt, base] of [[1, 1], [2, 2], [3, 4], [4, 8], [5, 15], [9, 15]]) {
      const d = backoff(attempt);
      expect(d).toBeGreaterThanOrEqual(base);
      expect(d).toBeLessThanOrEqual(base * 1.25);
    }
  });
});

describe('runResilientAsync', () => {
  it('reconnects after a drop and sends Settings again', async () => {
    delete process.env.DEEPGRAM_AGENT_URL;
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((r) => wss.once('listening', r));
    let settingsSeen = 0;
    wss.on('connection', (ws) => {
      ws.send(JSON.stringify({ type: 'Welcome', request_id: 'r' }));
      ws.on('message', (data, isBinary) => {
        if (isBinary || JSON.parse(data.toString()).type !== 'Settings') return;
        settingsSeen++;
        ws.send(JSON.stringify({ type: 'SettingsApplied' }));
        if (settingsSeen === 1) ws.terminate(); // the network drops: no close frame
        else ws.close(1000, 'done');
      });
    });
    const waits: number[] = [];
    const lines: string[] = [];
    try {
      const agent = await runResilientAsync({
        buildSettings: () => ({ agent: { greeting: 'Hi.' } }) as unknown as Settings,
        url: `ws://127.0.0.1:${wss.address().port}`,
        apiKey: FAKE_KEY,
        interactive: false,
        saveAudio: null,
        quiet: true,
        sleep: async (s) => void waits.push(s),
        log: (l) => lines.push(l),
      });
      expect(settingsSeen).toBe(2);
      expect(waits).toHaveLength(1);
      expect(lines[0]).toMatch(/^\[reconnect\] closed 1006 no close frame; /);
      expect(agent.closeCode).toBe(1000);
      expect(agent.hungUp).toBe(false);
    } finally {
      wss.close();
    }
  });
});

describe('LIVE_CLOSED', () => {
  it('stops runResilient: no reconnect after the proxy refuses with LIVE_CLOSED', async () => {
    delete process.env.DEEPGRAM_AGENT_URL;
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((r) => wss.once('listening', r));
    let connections = 0;
    wss.on('connection', (ws) => {
      connections++;
      ws.send(JSON.stringify({ type: 'Error', code: 'LIVE_CLOSED', description: 'closed' }));
      ws.close(1013, 'Live agent closed');
    });
    const waits: number[] = [];
    try {
      const agent = await runResilientAsync({
        buildSettings: () => ({}) as Settings,
        url: `ws://127.0.0.1:${wss.address().port}`,
        apiKey: FAKE_KEY,
        interactive: false,
        saveAudio: null,
        quiet: true,
        sleep: async (s) => void waits.push(s),
        log: () => {},
      });
      expect(agent.stopCode).toBe('LIVE_CLOSED');
      expect(agent.closeCode).toBe(1013);
      expect(connections).toBe(1);
      expect(waits).toEqual([]);
    } finally {
      wss.close();
    }
  });
});

// ---- refusals, the pause, piped lines and the credential, end to end through run() ----

const TSX = join(PROJECT_ROOT, 'typescript', 'node_modules', '.bin', 'tsx');
const PROGRAM =
  `import { run } from ${JSON.stringify(join(PROJECT_ROOT, 'typescript', 'src', 'common.ts'))};\n` +
  // TEST_SAVE keeps saving on (no audio comes, so nothing is written).
  "if (!process.env.TEST_SAVE) process.argv.push('--no-save');\n" +
  // TEST_GREETING sets agent.greeting; unset, the agent has none. TEST_HANG_UP: hang up on the first line.
  "const greeting = process.env.TEST_GREETING;\n" +
  // TEST_SLOW_TOOL: answer a FunctionCallRequest after a filler and a 1 s tool that holds onEvent (mission 03).
  "const onEvent = async (agent: any, e: { type: string }) => {\n" +
  "  if (process.env.TEST_HANG_UP && e.type === 'ConversationText') agent.close();\n" +
  "  if (process.env.TEST_SLOW_TOOL && e.type === 'FunctionCallRequest') {\n" +
  "    agent.injectAgentMessage('One second.', 'queue');\n" +
  "    await new Promise((r) => setTimeout(r, 1000));\n" +
  "    agent.functionCallResponse('fc_1', 'deleteItem', 'done');\n" +
  "  }\n" +
  "};\n" +
  "run({ buildSettings: () => ({ agent: greeting ? { greeting } : {} }) as never, onEvent: onEvent as never });\n";

/** Run a program through common.run() against a local server, with `stdin` piped in. */
async function runProgram(
  serve: (ws: Peer, auth: string | undefined) => void,
  stdin = '',
  env: (url: string) => Record<string, string> = () => ({}),
): Promise<{ status: number | null; out: string }> {
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>((r) => wss.once('listening', r));
  wss.on('connection', (ws, req) => serve(ws, req.headers.authorization));
  const url = `ws://127.0.0.1:${wss.address().port}`;
  const child = spawn(TSX, ['-e', PROGRAM], {
    env: { ...process.env, DEEPGRAM_API_KEY: FAKE_KEY, DEEPGRAM_AGENT_URL: url, WORKSHOP_TOKEN: '', WORKSHOP_URL: '', ...env(url) },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.stderr.on('data', (d) => (out += d));
  child.stdin.end(stdin);
  const status = await new Promise<number | null>((r) => child.on('close', r));
  wss.close();
  return { status, out };
}

describe('run(): the workshop refusals and the pause', () => {
  for (const code of ['TALK_UNCONFIGURED', 'TALK_PAUSED', 'ONLINE_FULL', 'LIVE_CLOSED']) {
    it(`prints ${code} as one line and exits non-zero`, async () => {
      const { status, out } = await runProgram((ws) => {
        ws.send(JSON.stringify({ type: 'Error', code, description: TALK_MESSAGES[code] }));
        ws.close(1013, 'Try again later');
      });
      expect(status, out).toBe(1);
      expect(out).toContain(`[workshop] ${TALK_MESSAGES[code]} (${code})`);
      expect(out).not.toContain('[closed]');
      expect(out).not.toContain('Type a line');
    });
  }

  it('ends cleanly when staff pause the agent mid-run', async () => {
    const { status, out } = await runProgram((ws) => {
      ws.send(JSON.stringify({ type: 'Welcome', request_id: 'r' }));
      ws.on('message', (data, isBinary) => {
        if (isBinary || JSON.parse(data.toString()).type !== 'Settings') return;
        ws.send(JSON.stringify({ type: 'SettingsApplied' }));
        ws.send(JSON.stringify({ type: 'Warning', code: 'TALK_PAUSED', description: TALK_MESSAGES.TALK_PAUSED }));
        ws.close(1000, 'Paused by staff');
      });
    }, 'hello\n'); // one line in flight, so the end of the input doesn't hang up first
    expect(status, out).toBe(0);
    expect(out).toContain(`[workshop] ${TALK_MESSAGES.TALK_PAUSED} (TALK_PAUSED)`);
  });
});

describe('run(): typed lines and the credential', () => {
  it('waits for the greeting before the first piped line, and gives each line its own reply', async () => {
    const log: Array<[string, number]> = [];
    const { status, out } = await runProgram(
      (ws) => {
        ws.send(JSON.stringify({ type: 'Welcome', request_id: 'r' }));
        let injects = 0;
        ws.on('message', (data, isBinary) => {
          if (isBinary) return;
          const m = JSON.parse(data.toString());
          if (m.type === 'Settings') {
            ws.send(JSON.stringify({ type: 'SettingsApplied' }));
            ws.send(JSON.stringify({ type: 'ConversationText', role: 'assistant', content: 'Hi, I am Sam.' }));
            setTimeout(() => {
              // The greeting played for a while: its audio is done now.
              log.push(['done', Date.now()]);
              ws.send(JSON.stringify({ type: 'AgentAudioDone' }));
            }, 400);
          }
          if (m.type === 'InjectUserMessage') {
            const n = ++injects;
            log.push(['inject', Date.now()]);
            ws.send(JSON.stringify({ type: 'ConversationText', role: 'user', content: m.content }));
            ws.send(JSON.stringify({ type: 'ConversationText', role: 'assistant', content: `reply ${n}` }));
            setTimeout(() => {
              log.push(['done', Date.now()]);
              ws.send(JSON.stringify({ type: 'AgentAudioDone' }));
            }, 200);
          }
        });
      },
      'one\ntwo\nthree\n',
      () => ({ TEST_GREETING: 'Hi, I am Sam.' }),
    );
    expect(status, out).toBe(0);
    const turns = out.split('\n').filter((l) => /^(user|assistant): /.test(l));
    expect(turns).toEqual(['assistant: Hi, I am Sam.', 'user: one', 'assistant: reply 1', 'user: two', 'assistant: reply 2', 'user: three', 'assistant: reply 3']);
    const injects = log.filter(([k]) => k === 'inject').map(([, at]) => at);
    const dones = log.filter(([k]) => k === 'done').map(([, at]) => at);
    expect(injects).toHaveLength(3);
    expect(dones).toHaveLength(4);
    injects.forEach((at, k) => expect(at, `line ${k + 1} went before turn ${k} finished`).toBeGreaterThanOrEqual(dones[k]));
    expect(out.indexOf('assistant: reply 3')).toBeLessThan(out.indexOf('[bye] end of input, hanging up.'));
  });

  it('sends piped lines one at a time and hangs up at the end of the input', async () => {
    const got: string[] = [];
    const { status, out } = await runProgram(
      (ws) => {
        ws.send(JSON.stringify({ type: 'Welcome', request_id: 'r' }));
        ws.on('message', (data, isBinary) => {
          if (isBinary) return;
          const m = JSON.parse(data.toString());
          if (m.type === 'Settings') ws.send(JSON.stringify({ type: 'SettingsApplied' }));
          if (m.type === 'InjectUserMessage') {
            got.push(m.content);
            const n = got.length;
            setTimeout(() => {
              ws.send(JSON.stringify({ type: 'ConversationText', role: 'assistant', content: `reply ${n}` }));
              ws.send(JSON.stringify({ type: 'AgentAudioDone' }));
            }, 200);
          }
        });
      },
      'hello\n\nwhat can you do?\n',
    );
    expect(status, out).toBe(0);
    expect(got).toEqual(['hello', 'what can you do?']);
    expect(out).toContain('Reading your lines from the input');
    expect(out).not.toContain('Type a line');
    expect(out.indexOf('assistant: reply 1')).toBeLessThan(out.indexOf('assistant: reply 2'));
    expect(out.indexOf('assistant: reply 2')).toBeLessThan(out.indexOf('[bye] end of input, hanging up.'));
  });

  it('runs on the workshop token, not a key in the shell, and says so in one line', async () => {
    const token = `wst_${'c'.repeat(43)}`;
    let auth: string | undefined;
    const { status, out } = await runProgram(
      (ws, a) => {
        auth = a;
        ws.send(JSON.stringify({ type: 'Welcome', request_id: 'r' }));
        ws.on('message', () => ws.close(1000, 'done'));
      },
      '',
      // DEEPGRAM_API_KEY stays set (as if exported in the shell); WORKSHOP_URL and the token win.
      (url) => ({ DEEPGRAM_AGENT_URL: '', WORKSHOP_TOKEN: token, WORKSHOP_URL: `${url}/sdk` }),
    );
    expect(status, out).toBe(0);
    expect(auth?.toLowerCase()).toBe(`bearer ${token}`);
    expect(out).toContain('[credentials] Using your workshop token (the proxy); your DEEPGRAM_API_KEY is set too and waits for after the event.');
    expect(out).not.toContain(FAKE_KEY);
    expect(out).not.toContain(token);
  });
});

describe('run(): closing lines', () => {
  const applied = (ws: Peer) => {
    ws.send(JSON.stringify({ type: 'Welcome', request_id: 'r' }));
    ws.on('message', (data, isBinary) => {
      if (isBinary || JSON.parse(data.toString()).type !== 'Settings') return;
      ws.send(JSON.stringify({ type: 'SettingsApplied' }));
      ws.send(JSON.stringify({ type: 'ConversationText', role: 'assistant', content: 'Bye now.' }));
    });
  };

  it('says your program hung up, and that a call with no audio saved no file', async () => {
    const { status, out } = await runProgram(applied, 'hello\n', () => ({ TEST_HANG_UP: '1', TEST_SAVE: '1' }));
    expect(status, out).toBe(0);
    expect(out.split(HUNG_UP_LINE)).toHaveLength(2);
    expect(out).not.toContain('end of input');
    expect(out.indexOf(HUNG_UP_LINE)).toBeLessThan(out.indexOf(NO_AUDIO_LINE));
  });

  it('says bye once at the end of the input, and nothing about audio with saving off', async () => {
    const { status, out } = await runProgram(applied, '');
    expect(status, out).toBe(0);
    expect(out).toContain('[bye] end of input, hanging up.');
    expect(out).not.toContain(HUNG_UP_LINE);
    expect(out).not.toContain('[no audio]');
  });
});

describe('run(): a piped turn with a slow tool', () => {
  it('sends the next line only after the reply that follows your answer, not after the filler', async () => {
    const log: string[] = [];
    const { status, out } = await runProgram(
      (ws) => {
        const say = (content: string, ms = 200) => {
          ws.send(JSON.stringify({ type: 'ConversationText', role: 'assistant', content }));
          setTimeout(() => {
            log.push(`done ${content}`);
            ws.send(JSON.stringify({ type: 'AgentAudioDone' }));
          }, ms);
        };
        ws.send(JSON.stringify({ type: 'Welcome', request_id: 'r' }));
        ws.on('message', (data, isBinary) => {
          if (isBinary) return;
          const m = JSON.parse(data.toString());
          if (m.type === 'Settings') ws.send(JSON.stringify({ type: 'SettingsApplied' }));
          if (m.type === 'InjectUserMessage') {
            log.push(`user ${m.content}`);
            if (m.content.startsWith('delete')) {
              ws.send(JSON.stringify({ type: 'FunctionCallRequest', functions: [{ id: 'fc_1', name: 'deleteItem', arguments: '{}', client_side: true }] }));
            } else say(`reply to ${m.content}`);
          }
          if (m.type === 'InjectAgentMessage') say(m.message);
          if (m.type === 'FunctionCallResponse') {
            log.push('answered');
            say('Deleted it.', 500);
          }
        });
      },
      'delete buy milk\nwhat is left\nbye now\n',
      () => ({ TEST_SLOW_TOOL: '1' }),
    );
    expect(status, out).toBe(0);
    expect(log).toEqual([
      'user delete buy milk', 'done One second.', 'answered', 'done Deleted it.',
      'user what is left', 'done reply to what is left', 'user bye now', 'done reply to bye now',
    ]);
  });
});

// ---- a key a header can't carry, through runResilient (code points keep this file ASCII) ----

describe("runResilient with a key a header can't carry", () => {
  it('prints exactly the line, exits 2 and never connects', async () => {
    let connections = 0;
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise<void>((r) => wss.once('listening', r));
    wss.on('connection', (ws) => {
      connections += 1;
      ws.terminate();
    });
    const marker = 'leakprobe0123456789abcdef';
    const program =
      `import { runResilient } from ${JSON.stringify(join(PROJECT_ROOT, 'typescript', 'src', 'resilient.ts'))};\n` +
      "process.argv.push('--no-save');\n" +
      'runResilient({ buildSettings: () => ({}) as never });\n';
    const env: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(process.env)) if (!/^(DEEPGRAM|WORKSHOP)_/.test(name)) env[name] = value;
    Object.assign(env, {
      DEEPGRAM_API_KEY: String.fromCodePoint(0x201c) + marker + String.fromCodePoint(0x201d),
      DEEPGRAM_AGENT_URL: `ws://127.0.0.1:${wss.address().port}`,
      WORKSHOP_TOKEN: '',
      WORKSHOP_URL: '',
    });
    const child = spawn(TSX, ['-e', program], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout!.on('data', (d) => (stdout += d));
    child.stderr!.on('data', (d) => (stderr += d));
    const status = await new Promise<number | null>((r) => child.on('close', r));
    await new Promise((r) => setTimeout(r, 200)); // let a connection that is on its way be counted
    wss.close();
    expect(status, stdout + stderr).toBe(2);
    expect(stderr.trim()).toBe(
      "DEEPGRAM_API_KEY has a character a key can't have (a curly quote or a hidden space, often from copy and paste). Copy it again as plain text.",
    );
    expect(stdout + stderr).not.toContain(marker);
    expect(stdout + stderr).not.toContain(String.fromCodePoint(0x201c));
    expect(stdout + stderr).not.toMatch(/^\s+at /m);
    expect(connections).toBe(0);
  }, 30_000);
});
