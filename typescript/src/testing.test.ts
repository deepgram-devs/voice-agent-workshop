// Unit tests for the check runner (testing.ts). `make ci` runs them (`make unit`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PathLike } from 'node:fs';
import { NO_CREDENTIALS, PROJECT_ROOT, noCredentialsLine } from './common.js';

// The project's .env as the live check sees it: present (make setup's, key empty) or not.
// Stubbed, never written: CI's matrix jobs run make setup-ts (no .env), the other jobs make setup.
const dotenv = vi.hoisted(() => ({ present: undefined as boolean | undefined }));
vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof import('node:fs')>();
  return {
    ...fs,
    existsSync: (p: PathLike) =>
      dotenv.present !== undefined && /[\\/]\.env$/.test(String(p)) ? dotenv.present : fs.existsSync(p),
  };
});
import { countingServer } from './counting-server.js';
import {
  checkLive, checkReplay, editSpot, failCheck, loadTarget, replayScenarios, whereToEdit, type MissionModule,
} from './testing.js';

const MISSION_00 = pathToFileURL(join(PROJECT_ROOT, 'typescript', 'missions', '00-first-words', '00.test.ts')).href;
const START_00 = join(PROJECT_ROOT, 'typescript', 'missions', '00-first-words', 'start.ts');

const saved = { key: process.env.DEEPGRAM_API_KEY, token: process.env.WORKSHOP_TOKEN };
afterEach(() => {
  for (const [name, value] of [['DEEPGRAM_API_KEY', saved.key], ['WORKSHOP_TOKEN', saved.token]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe('where a failed check points', () => {
  it('names your start file at the first failing TODO', () => {
    const line = whereToEdit(MISSION_00, '  PASS  TODO 1: ok\n  FAIL  TODO 2: you picked a voice');
    expect(line).toMatch(/^Your file: typescript\/missions\/00-first-words\/start\.ts:\d+ \(TODO 2\)$/);
    const n = editSpot(MISSION_00, '  FAIL  TODO 2: x').line!;
    expect(readFileSync(START_00, 'utf8').split('\n')[n - 1]).toContain('TODO 2');
    // No TODO in the report (a wrong `version`, say): the line of buildSettings(), where the Settings are.
    const fallback = whereToEdit(MISSION_00, '  FAIL  agent.speak.provider: aura-2-thalia-en is an Aura voice');
    expect(fallback).toMatch(/^Your file: typescript\/missions\/00-first-words\/start\.ts:\d+ \(buildSettings\(\)\)$/);
    const fb = Number(/:(\d+) /.exec(fallback)![1]);
    expect(readFileSync(START_00, 'utf8').split('\n')[fb - 1]).toMatch(/function buildSettings/);
  });

  it('throws with a stack that names your start file, not the test file', () => {
    let thrown: Error | undefined;
    try {
      failCheck(MISSION_00, { passed: false, report: '  FAIL  TODO 3: agent.greeting is set' });
    } catch (err) {
      thrown = err as Error;
    }
    expect(thrown?.message).toContain('FAIL  TODO 3');
    const frames = thrown!.stack!.split('\n').filter((l) => l.trim().startsWith('at '));
    expect(frames).toHaveLength(1);
    expect(frames[0]).toContain(pathToFileURL(START_00).href);
    expect(frames[0]).not.toContain('00.test.ts');
  });

  it('leaves the stack without a frame when there is no TODO line to show', () => {
    try {
      failCheck(MISSION_00, { passed: false, report: NO_CREDENTIALS });
    } catch (err) {
      expect((err as Error).stack).not.toMatch(/\n\s+at /);
    }
  });
});

describe('make live with no credentials', () => {
  afterEach(() => {
    dotenv.present = undefined;
  });

  /** The two report lines of a live check with no key and no token, in under two seconds. */
  async function reportLines(): Promise<[string, string]> {
    process.env.DEEPGRAM_API_KEY = ''; // set and empty, so .env can't fill it in
    process.env.WORKSHOP_TOKEN = '';
    const started = Date.now();
    const verdict = await checkLive(MISSION_00, {} as MissionModule);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(verdict.passed).toBe(false);
    const [first, second] = verdict.report.split('\n');
    expect(second).toMatch(/^make live talks to the real agent/);
    expect(second).toContain('make check 00');
    return [first, second];
  }

  it('with .env there (key empty): the "is empty" line, then the live hint', async () => {
    dotenv.present = true;
    const [first] = await reportLines();
    expect(first).toBe(noCredentialsLine('00-first-words', true));
    expect(first).toMatch(/make check 00 runs offline with no key\.$/);
  });

  it('with no .env: the copy line, then the live hint', async () => {
    dotenv.present = false;
    const [first] = await reportLines();
    expect(first).toBe(noCredentialsLine('00-first-words', false));
    expect(first).toBe(NO_CREDENTIALS);
  });
});

// ---- a key a header can't carry (built from code points, so this file stays ASCII) ----

const KEY_LINE =
  "DEEPGRAM_API_KEY has a character a key can't have (a curly quote or a hidden space, often from copy and paste). Copy it again as plain text.";
const CURLY_KEY = `${String.fromCodePoint(0x201c)}leakprobe0123456789abcdef${String.fromCodePoint(0x201d)}`;

/** All four credential variables ('' when unused), so a developer's .env can't fill one in. */
function setCredentials(values: Record<string, string>): void {
  for (const name of ['DEEPGRAM_API_KEY', 'DEEPGRAM_AGENT_URL', 'WORKSHOP_TOKEN', 'WORKSHOP_URL']) process.env[name] = values[name] ?? '';
}

describe("make live and make check with a key a header can't carry", () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('make live says only the key line, and never connects', async () => {
    const server = await countingServer();
    try {
      // DEEPGRAM_AGENT_URL is where the harness's live upstream goes: the counting listener.
      setCredentials({ DEEPGRAM_API_KEY: CURLY_KEY, DEEPGRAM_AGENT_URL: `ws://127.0.0.1:${server.port}` });
      const verdict = await checkLive(MISSION_00, { buildSettings: () => ({}) } as unknown as MissionModule);
      expect(verdict.passed).toBe(false);
      expect(verdict.report).toBe(KEY_LINE); // the line ends on its own fix: no live hint after it
      expect(await server.connections()).toBe(0);
    } finally {
      server.close();
    }
  }, 30_000);

  it('make check sends the replay key, so a bad key in .env never blocks it', async () => {
    const server = await countingServer();
    try {
      process.env.MISSION_TARGET = 'solution';
      setCredentials({ DEEPGRAM_API_KEY: CURLY_KEY, DEEPGRAM_AGENT_URL: `ws://127.0.0.1:${server.port}` });
      const mission = await loadTarget(MISSION_00);
      for (const scenario of replayScenarios(MISSION_00)) {
        const verdict = await checkReplay(MISSION_00, mission, scenario);
        expect(verdict.passed, verdict.report).toBe(true);
      }
      expect(await server.connections()).toBe(0);
    } finally {
      server.close();
    }
  }, 60_000);
});

describe('make live when the harness stops before it listens', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('carries the harness line in the report, so the CheckFailed vitest prints is not empty', async () => {
    // A token with DEEPGRAM_AGENT_URL set and no key: the harness refuses the target before it
    // listens.
    setCredentials({ WORKSHOP_TOKEN: 'wst_unit-test-token', WORKSHOP_URL: 'wss://127.0.0.1:9/sdk', DEEPGRAM_AGENT_URL: 'ws://127.0.0.1:9' });
    const verdict = await checkLive(MISSION_00, { buildSettings: () => ({}) } as unknown as MissionModule);
    expect(verdict.passed).toBe(false);
    expect(verdict.report).toBe(
      'harness: DEEPGRAM_AGENT_URL needs your own DEEPGRAM_API_KEY. With a workshop token, leave DEEPGRAM_AGENT_URL empty: the workshop proxy picks the endpoint.',
    );
  }, 30_000);
});
