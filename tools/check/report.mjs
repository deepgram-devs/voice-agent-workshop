#!/usr/bin/env node
// `make check NN FORMAT=json`: turn one track's check output into one JSON line.
//
//   node tools/check/report.mjs --track py --mission 00-first-words --target start \
//     --file python/missions/00-first-words/start.py --status 1 --again "make check 00" < output.txt
//   node tools/check/report.mjs --stop "Pick your language first: ..." --again "make check 00"
//
// Every track (pytest, vitest, Java) prints the same lines from missions/NN/check.mjs:
// "  PASS  text" and "  FAIL  text", and "Your file: path:line (TODO n)" after a failure.
// This reads those lines, so the three tracks give one shape. A failed line becomes an error
// in the shape of tools/check/errors.json (the site's errors.json, vendored): code, message,
// hint, doc_url, retryable. Anything else that stopped the check is VERIFIER_ERROR.
// stdout is the JSON line and nothing else; make sends the human text to stderr.

import { readFileSync } from 'node:fs';

const REPO = 'https://github.com/deepgram-devs/voice-agent-workshop';
const WORKSHOP = 'voice-agent';
const TROUBLESHOOTING = `${REPO}/blob/main/docs/troubleshooting.md`;

// The codes this tool emits. VERIFIER_ERROR and CHECKPOINT_NOT_FOUND are in the site's
// registry for the make-check surface; CHECK_FAILED is the one this tool adds (see PR).
export const CODES = Object.freeze({
  CHECK_FAILED: {
    message: 'A check on your file did not pass.',
    hint: 'Fix the TODO the check names, save the file, then run the check again.',
    retryable: true,
  },
  VERIFIER_ERROR: {
    message: "The check couldn't run.",
    hint: 'Run it again. If it keeps failing, read the output above the JSON on stderr.',
    retryable: true,
  },
  CHECKPOINT_NOT_FOUND: {
    message: "There's no check for that yet.",
    hint: 'Pick another mission, or another language.',
    retryable: false,
  },
});

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;

export function stripAnsi(s) {
  return s.replace(ANSI, '');
}

const slug = (s) => (/^[a-z0-9]+(-[a-z0-9]+)*$/.test(s ?? '') ? s : undefined);

/** Read the PASS and FAIL lines out of one track's output. */
export function parseOutput(text) {
  const checks = [];
  let scenario;
  let file;
  let lastFail;
  for (const raw of stripAnsi(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    const head = /\b(\d\d-[a-z0-9-]+) (replay|live) "([^"]*)"/.exec(line);
    if (head) scenario = `${head[2]}: ${head[3]}`;
    const m = /^\s*(PASS|FAIL)\s+(\S.*)$/.exec(line);
    if (m) {
      const todo = /^TODO (\d+):/.exec(m[2]);
      const c = { status: m[1] === 'PASS' ? 'pass' : 'fail', text: m[2] };
      if (todo) c.todo = Number(todo[1]);
      if (scenario) c.scenario = scenario;
      checks.push(c);
      if (c.status === 'fail') lastFail = c;
      continue;
    }
    const f = /^Your file: (\S+?)(?::(\d+))?(?: \(TODO (\d+)\))?$/.exec(line);
    if (f) {
      file = f[1];
      if (lastFail && !lastFail.file) {
        // The file line follows its scenario's lines: it belongs to the first failure of that scenario.
        for (const c of checks) if (c.status === 'fail' && c.scenario === lastFail.scenario && !c.file) {
          c.file = f[1];
          if (f[2]) c.line = Number(f[2]);
          break;
        }
      }
    }
  }
  return { checks, file };
}

function errorBody(code, { message, hint, step, next_command, doc_url } = {}) {
  const base = CODES[code];
  const error = { code, message: message ?? base.message, hint: hint ?? base.hint, doc_url: doc_url ?? TROUBLESHOOTING, retryable: base.retryable };
  if (step) error.step = step;
  if (next_command) error.next_command = next_command;
  return { error };
}

/** One report: { ok, track, mission, target, file, checks[], errors[] }. Each error is an errors.json body. */
export function buildReport({ track, mission, target = 'start', file, status = 0, again, output = '' }) {
  const parsed = parseOutput(output);
  const m = slug(mission);
  const step = m ? { workshop: WORKSHOP, mission: m } : undefined;
  const doc_url = m ? `${REPO}/blob/main/missions/${m}/README.md` : TROUBLESHOOTING;
  const errors = [];
  for (const c of parsed.checks) {
    if (c.status !== 'fail') continue;
    errors.push(errorBody('CHECK_FAILED', { message: c.text.length ? c.text : undefined, step, next_command: again, doc_url }));
  }
  // A failed exit with no FAIL line: the check never ran (a file that doesn't parse, a missing install).
  if (Number(status) !== 0 && errors.length === 0) {
    errors.push(errorBody('VERIFIER_ERROR', { step, next_command: again }));
  }
  const ok = Number(status) === 0 && errors.length === 0;
  const report = { ok, track, mission: m ?? mission, target };
  const f = parsed.file ?? file;
  if (f) report.file = f;
  report.checks = parsed.checks;
  report.errors = errors;
  return report;
}

/** A stop before any check ran (no language picked, harness not installed, no such mission). */
export function stopReport({ message, again, mission }) {
  const m = slug(mission);
  return {
    ok: false,
    ...(m ? { mission: m } : {}),
    checks: [],
    errors: [errorBody('VERIFIER_ERROR', { message: 'The check could not start.', hint: message, step: m ? { workshop: WORKSHOP, mission: m } : undefined, next_command: again || undefined })],
  };
}

/** A language with no check for this mission yet. */
export function notYetReport({ track, mission, message, again }) {
  const m = slug(mission);
  return {
    ok: false,
    track,
    mission: m ?? mission,
    checks: [],
    errors: [errorBody('CHECKPOINT_NOT_FOUND', { message: message || undefined, step: m ? { workshop: WORKSHOP, mission: m } : undefined, next_command: again || undefined })],
  };
}

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) a[key] = true;
      else { a[key] = next; i += 1; }
    }
  }
  return a;
}

function main() {
  const a = parseArgs(process.argv.slice(2));
  let report;
  if (a.stop) report = stopReport({ message: String(a.stop), again: a.again, mission: a.mission });
  else if (a['not-yet']) report = notYetReport({ track: a.track, mission: a.mission, message: typeof a['not-yet'] === 'string' ? a['not-yet'] : '', again: a.again });
  else report = buildReport({ track: a.track, mission: a.mission, target: a.target || 'start', file: a.file, status: a.status ?? 0, again: a.again, output: readFileSync(0, 'utf8') });
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
