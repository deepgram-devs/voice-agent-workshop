// The examples run offline against the mission 00 replay. `make ci` runs this (`make unit`).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';
import { PROJECT_ROOT } from './common.js';
import { countingServer } from './counting-server.js';

describe('examples/first-settings.ts', () => {
  it('sends Settings first and saves the voice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'first-settings-'));
    const dump = join(dir, 'session.json');
    const harness = spawn(process.execPath, [join(PROJECT_ROOT, 'tools', 'replay-server', 'harness.mjs'), 'replay', '00', 'greeting', '--dump', dump], {
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const url = await new Promise<string>((r) => createInterface({ input: harness.stdout! }).on('line', (l) => l.startsWith('READY ') && r(l.slice(6))));
    const env: NodeJS.ProcessEnv = { ...process.env, DEEPGRAM_API_KEY: 'replay-check-no-real-key', DEEPGRAM_AGENT_URL: url };
    delete env.WORKSHOP_TOKEN;
    const wav = join(dir, 'voice.wav');
    const run = spawnSync(process.execPath, ['--import', 'tsx', join('examples', 'first-settings.ts'), wav], {
      cwd: join(PROJECT_ROOT, 'typescript'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 30_000,
    });
    await new Promise((r) => (harness.exitCode !== null ? r(null) : harness.on('close', r)));
    expect(run.status, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain('[ready]');
    expect(run.stdout).toContain('assistant: Hi there.');
    expect(readFileSync(wav).subarray(0, 4).toString()).toBe('RIFF');
    const events = JSON.parse(readFileSync(dump, 'utf8')).events as { dir: string; frame?: { type: string } }[];
    expect(events.filter((e) => e.dir === 'client' && e.frame).map((e) => e.frame!.type)[0]).toBe('Settings');
  });

  it('takes a converse URL with a trailing slash, and the SDK adds the path once', async () => {
    const paths: string[] = [];
    const server = createServer();
    server.on('upgrade', (req, socket) => {
      paths.push(req.url ?? '');
      socket.destroy();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    const port = (server.address() as { port: number }).port;
    const env: NodeJS.ProcessEnv = { ...process.env, DEEPGRAM_API_KEY: 'x-test-key', DEEPGRAM_AGENT_URL: `ws://127.0.0.1:${port}/v1/agent/converse/` };
    for (const name of Object.keys(env)) if (name.startsWith('WORKSHOP_')) delete env[name];
    const dir = mkdtempSync(join(tmpdir(), 'first-settings-'));
    const run = spawn(process.execPath, ['--import', 'tsx', join('examples', 'first-settings.ts'), join(dir, 'voice.wav')], {
      cwd: join(PROJECT_ROOT, 'typescript'),
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    run.stdout!.on('data', (d) => (out += d));
    run.stderr!.on('data', (d) => (out += d));
    const deadline = Date.now() + 20_000;
    while (!paths.length && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    run.kill();
    server.close();
    expect(paths[0], out).toBe('/v1/agent/converse');
  }, 30_000);
});

// ---- a key a header can't carry (built from code points, so this file stays ASCII) ----

const KEY_LINE =
  "DEEPGRAM_API_KEY has a character a key can't have (a curly quote or a hidden space, often from copy and paste). Copy it again as plain text.";

describe('examples/first-settings.ts with a curly-quoted key', () => {
  it('says so, exits 2 before any connection, and never prints the key', async () => {
    const server = await countingServer();
    const marker = 'leakprobe0123456789abcdef';
    const lq = String.fromCodePoint(0x201c);
    const env: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(process.env)) if (!/^(DEEPGRAM|WORKSHOP)_/.test(name)) env[name] = value;
    Object.assign(env, {
      DEEPGRAM_API_KEY: lq + marker + String.fromCodePoint(0x201d),
      DEEPGRAM_AGENT_URL: `ws://127.0.0.1:${server.port}`,
      WORKSHOP_TOKEN: '',
      WORKSHOP_URL: '',
    });
    const dir = mkdtempSync(join(tmpdir(), 'first-settings-'));
    try {
      const run = spawnSync(process.execPath, ['--import', 'tsx', join('examples', 'first-settings.ts'), join(dir, 'voice.wav')], {
        cwd: join(PROJECT_ROOT, 'typescript'),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 30_000,
      });
      const out = run.stdout + run.stderr;
      expect(run.status, out).toBe(2);
      expect(run.stderr.trim()).toBe(KEY_LINE);
      expect(out).not.toContain(marker);
      expect(out).not.toContain(lq);
      expect(out).not.toMatch(/^\s+at /m);
      expect(await server.connections()).toBe(0);
    } finally {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('examples/first-settings.ts with nothing listening', () => {
  it("prints the helpers' one line, exits 2, and shows no stack", async () => {
    const probe = await countingServer();
    const port = probe.port;
    probe.close(); // a port nothing listens on
    const env: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(process.env)) if (!/^(DEEPGRAM|WORKSHOP)_/.test(name)) env[name] = value;
    Object.assign(env, { DEEPGRAM_API_KEY: 'x-test-key', DEEPGRAM_AGENT_URL: `ws://127.0.0.1:${port}`, WORKSHOP_TOKEN: '', WORKSHOP_URL: '' });
    const dir = mkdtempSync(join(tmpdir(), 'first-settings-'));
    try {
      const run = spawnSync(process.execPath, ['--import', 'tsx', join('examples', 'first-settings.ts'), join(dir, 'voice.wav')], {
        cwd: join(PROJECT_ROOT, 'typescript'),
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 30_000,
      });
      const out = run.stdout + run.stderr;
      expect(run.status, out).toBe(2);
      expect(run.stderr.trim()).toBe('Could not reach the agent: connection refused. Check DEEPGRAM_AGENT_URL.');
      expect(out).not.toMatch(/^\s+at /m);
      expect(out).not.toContain(String(port));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

// ---- no key: the example reads the key only, and says so in its own words ----

const EX_EMPTY =
  'DEEPGRAM_API_KEY is empty in .env (this folder). Set it: this example runs ' +
  'on your own key only (make run takes a workshop token too). ' +
  'make check NN runs offline with no key.';
const EX_NOENV =
  'No Deepgram credentials. Copy .env.example to .env and set DEEPGRAM_API_KEY ' +
  '(free key: https://console.deepgram.com/signup): this example runs on ' +
  'your own key only (make run takes a workshop token too).';

describe('examples/first-settings.ts with no key', () => {
  it('asks for a key, exits 2, and never names the token lines it ignores', () => {
    // The two token lines set and no key: the `is empty` form with the project's .env present
    // (make setup creates it), else the `No Deepgram credentials` form; neither names the token.
    const env: NodeJS.ProcessEnv = {};
    for (const [name, value] of Object.entries(process.env)) {
      if (!/^(DEEPGRAM|WORKSHOP)_/.test(name)) env[name] = value;
    }
    Object.assign(env, {
      DEEPGRAM_API_KEY: '',
      DEEPGRAM_AGENT_URL: 'ws://127.0.0.1:9',
      WORKSHOP_TOKEN: 'wst_unit-test-token',
      WORKSHOP_URL: 'ws://127.0.0.1:9/sdk',
    });
    const dir = mkdtempSync(join(tmpdir(), 'first-settings-'));
    try {
      const run = spawnSync(
        process.execPath,
        ['--import', 'tsx', join('examples', 'first-settings.ts'), join(dir, 'voice.wav')],
        {
          cwd: join(PROJECT_ROOT, 'typescript'),
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8',
          timeout: 30_000,
        },
      );
      const out = run.stdout + run.stderr;
      expect(run.status, out).toBe(2);
      const expected = existsSync(join(PROJECT_ROOT, '.env')) ? EX_EMPTY : EX_NOENV;
      expect(run.stderr.trim()).toBe(expected);
      expect(out).not.toContain('WORKSHOP');
      expect(out).not.toContain('/code page');
      expect(out).not.toMatch(/^\s+at /m);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});
