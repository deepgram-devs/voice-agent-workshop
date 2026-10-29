// Runs a mission against the check harness (tools/replay-server) from vitest.
//
//   replay: the harness plays a recorded conversation; no key, no network.
//   live:   the harness relays to the real API and checks what really happened.
//
// Mission tests stay a few lines long; see missions/00-first-words/00.test.ts.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PROJECT_ROOT, SetupError, credentialsProblem, describeError, loadEnv, runAsync, type BuildSettings, type OnEvent } from './common.js';

const HARNESS = join(PROJECT_ROOT, 'tools', 'replay-server', 'harness.mjs');
const REPLAY_KEY = 'replay-check-no-real-key';

export interface MissionModule {
  buildSettings: BuildSettings;
  onEvent?: OnEvent;
}

export interface Verdict {
  passed: boolean;
  report: string;
}

/** Live tests run only under `make live NN` (LIVE=1). */
export const LIVE = process.env.LIVE === '1';

/** Which file a check runs: start.ts (yours, the default) or solution.ts. */
export function target(): 'start' | 'solution' {
  const value = (process.env.MISSION_TARGET ?? 'start').trim() || 'start';
  if (value !== 'start' && value !== 'solution') throw new Error('MISSION_TARGET must be start or solution');
  return value;
}

export function missionName(testUrl: string): string {
  return basename(dirname(fileURLToPath(testUrl)));
}

/** The file a check runs: typescript/missions/NN-name/start.ts (or solution.ts). */
export function targetPath(testUrl: string): string {
  return join(dirname(fileURLToPath(testUrl)), `${target()}.ts`);
}

export async function loadTarget(testUrl: string): Promise<MissionModule> {
  return (await import(pathToFileURL(targetPath(testUrl)).href)) as MissionModule;
}

/** The second line when `make live` has no credentials: what it needs, and the offline check. */
export function liveHint(testUrl: string): string {
  const nn = missionName(testUrl).slice(0, 2);
  return (
    'make live talks to the real agent, so it needs DEEPGRAM_API_KEY in .env (or WORKSHOP_URL and ' +
    `WORKSHOP_TOKEN from the workshop's /code page). make check ${nn} runs offline with no key.`
  );
}

/**
 * Where to work: your file, and the line of the first TODO the report says failed. With
 * that TODO's comment gone (or no TODO in the report, as for a wrong `version`), the line
 * is buildSettings(), where every mission's Settings are built (`fallback`).
 */
export function editSpot(testUrl: string, report: string): { file: string; line?: number; todo?: string; fallback?: boolean } {
  const file = targetPath(testUrl);
  const todo = /FAIL\s+TODO (\d+)/.exec(report)?.[1];
  if (!existsSync(file)) return { file };
  const lines = readFileSync(file, 'utf8').split('\n');
  if (todo) {
    const marker = new RegExp(`(#|//)\\s*TODO ${todo}\\b`);
    const index = lines.findIndex((l) => marker.test(l));
    if (index >= 0) return { file, line: index + 1, todo };
  }
  if (!/^\s*FAIL\s/m.test(report)) return { file }; // a setup stop (no credentials): nothing in your file to point at
  const settings = lines.findIndex((l) => /^\s*(export\s+)?(async\s+)?function buildSettings\b/.test(l));
  return settings >= 0 ? { file, line: settings + 1, todo, fallback: true } : { file };
}

/** One line naming your file, at the first TODO the report says failed. */
export function whereToEdit(testUrl: string, report: string): string {
  const spot = editSpot(testUrl, report);
  const shown = relative(PROJECT_ROOT, spot.file);
  if (!spot.line) return `Your file: ${shown}`;
  if (!spot.fallback) return `Your file: ${shown}:${spot.line} (TODO ${spot.todo})`;
  return spot.todo
    ? `Your file: ${shown}:${spot.line} (TODO ${spot.todo}; its // TODO comment is gone, so start at buildSettings())`
    : `Your file: ${shown}:${spot.line} (buildSettings())`;
}

/**
 * Fail a check with its report, pointing at your file rather than the test file:
 * the stack names your start file at the first failing TODO, so the code frame
 * vitest prints under a failure shows the code you are working on.
 */
export function failCheck(testUrl: string, verdict: Verdict): never {
  const spot = editSpot(testUrl, verdict.report);
  const err = new Error(verdict.report);
  err.name = 'CheckFailed';
  // With no failing TODO (no key, say), no frame at all: there is no line to point at.
  err.stack = `${err.name}: ${verdict.report}${spot.line ? `\n    at ${pathToFileURL(spot.file).href}:${spot.line}:1` : ''}`;
  throw err;
}

function harnessReady(): void {
  if (!existsSync(join(dirname(HARNESS), 'node_modules'))) {
    throw new Error("The check harness isn't installed. Run make setup in the voice-agent-workshop folder.");
  }
}

export function replayScenarios(testUrl: string): string[] {
  harnessReady();
  const out = spawnSync(process.execPath, [HARNESS, 'list', missionName(testUrl)], { encoding: 'utf8' });
  if (out.status !== 0) throw new Error(out.stderr || out.stdout);
  return JSON.parse(out.stdout).replay as string[];
}

/** The harness output a person reads: its READY and VERDICT lines are for this code only. */
function report(lines: string[]): string {
  return lines.filter((l) => !l.startsWith('READY ') && !l.startsWith('VERDICT ')).join('\n').replace(/^\n+|\n+$/g, '');
}

async function check(mode: 'replay' | 'live', testUrl: string, mod: MissionModule, scenario?: string): Promise<Verdict> {
  harnessReady();
  loadEnv();
  if (mode === 'live') {
    // Fail at once, before the harness waits for a program that can't connect.
    const problem = credentialsProblem(undefined, missionName(testUrl));
    if (problem) return { passed: false, report: `${problem}\n${liveHint(testUrl)}` };
  }
  // --source: the harness reads your file for old API field names.
  const args = [HARNESS, mode, missionName(testUrl), ...(scenario ? [scenario] : []), '--source', targetPath(testUrl)];
  // Mission authors: save this live run as a fixture (see CONTRIBUTING.md).
  if (mode === 'live' && process.env.RECORD_FIXTURE) args.push('--record', resolve(process.env.RECORD_FIXTURE));
  // stderr piped too: the harness's own stop lines (`harness: ...`, a Node.js version line) go
  // into the report, as the Python and Java runners merge them, so a check that stops before
  // READY fails with that line and not with an empty CheckFailed.
  const proc = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  const lines: string[] = [];
  createInterface({ input: proc.stderr! }).on('line', (line) => lines.push(line));
  const exited = new Promise<void>((r) => proc.on('close', () => r()));
  const url = await new Promise<string | null>((resolveUrl) => {
    const rl = createInterface({ input: proc.stdout! });
    rl.on('line', (line) => {
      lines.push(line);
      if (line.startsWith('READY ')) resolveUrl(line.slice(6));
    });
    rl.on('close', () => resolveUrl(null));
  });
  if (!url) {
    await exited;
    return { passed: false, report: report(lines) };
  }
  let clientError = '';
  let setupError = '';
  try {
    await runAsync({
      buildSettings: mod.buildSettings,
      onEvent: mod.onEvent,
      url,
      apiKey: mode === 'replay' ? REPLAY_KEY : undefined, // live: your DEEPGRAM_API_KEY, forwarded by the harness
      interactive: false,
      saveAudio: null,
      replay: mode === 'replay',
    });
  } catch (err) {
    if (err instanceof SetupError) {
      // Your program couldn't start (no credentials, a bad URL): say so first, and stop
      // the harness now rather than let it wait for a connection that won't come.
      setupError = err.message;
      proc.kill();
    } else clientError = `your program stopped with ${describeError(err)}`;
  }
  await exited;
  // A setup line ends on its own fix; the hint is for missing credentials only.
  if (setupError) return { passed: false, report: setupError };
  const verdictLine = [...lines].reverse().find((l) => l.startsWith('VERDICT '));
  const verdict = verdictLine ? JSON.parse(verdictLine.slice(8)) : { pass: false };
  const passed = Boolean(verdict.pass) && !clientError;
  let text = report(lines) + (clientError ? `\n${clientError}` : '');
  // A refused session (stopped) has nothing in your file to change, so no file line.
  if (!passed && !verdict.stopped) text += `\n${whereToEdit(testUrl, text)}`;
  return { passed, report: text };
}

export const checkReplay = (testUrl: string, mod: MissionModule, scenario: string) => check('replay', testUrl, mod, scenario);
export const checkLive = (testUrl: string, mod: MissionModule) => check('live', testUrl, mod);
