// node --test tools/ci/workflow-guard.test.mjs
//
// ci.yml's nightly schedule and its live jobs run only on the upstream repo. A fork, a
// template copy or a classroom clone gets the offline jobs on its own pushes and pull
// requests, and nothing on a timer: every job carries a github.repository guard, the
// live jobs (and the name scan, which needs an upstream secret) unconditionally, every
// other job on the schedule path.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..', '..');
export const UPSTREAM = "github.repository == 'deepgram-devs/voice-agent-workshop'";
export const SCHEDULE_GUARD = `github.event_name != 'schedule' || ${UPSTREAM}`;

/**
 * The top-level `on:` keys and each job's `if:` (folded scalars joined with spaces), read
 * from the workflow's text by indentation. Enough YAML for this file; no dependency.
 */
export function readWorkflow(text) {
  const lines = text.split('\n');
  const on = [];
  const jobs = {};
  let section = '';
  let job = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\S/.test(line) && !line.startsWith('#')) {
      section = line.replace(/:.*$/, '');
      job = null;
      continue;
    }
    if (section === 'on') {
      const m = /^ {2}([\w-]+):/.exec(line);
      if (m) on.push(m[1]);
    } else if (section === 'jobs') {
      const m = /^ {2}([\w-]+):\s*$/.exec(line);
      if (m) {
        job = m[1];
        jobs[job] = { if: null };
        continue;
      }
      const cond = /^ {4}if:\s*(.*)$/.exec(line);
      if (job && cond) {
        let value = cond[1].trim();
        if (/^[>|][-+]?$/.test(value)) {
          const parts = [];
          while (i + 1 < lines.length && (/^ {6,}\S/.test(lines[i + 1]) || !lines[i + 1].trim())) parts.push(lines[++i].trim());
          value = parts.filter(Boolean).join(' ');
        }
        jobs[job].if = value;
      }
    }
  }
  return { on, jobs };
}

const isLive = (name) => /^live\b/.test(name);
const UPSTREAM_ONLY = new Set(['names']);

/** Problems with a workflow's guards. */
export function guardProblems(text) {
  const { on, jobs } = readWorkflow(text);
  const problems = [];
  if (!Object.keys(jobs).length) problems.push('no jobs found');
  for (const [name, { if: cond }] of Object.entries(jobs)) {
    const c = (cond ?? '').replace(/\s+/g, ' ');
    if (isLive(name) || UPSTREAM_ONLY.has(name)) {
      // The guard must be a top-level conjunct: "<guard> && …", not inside an "||".
      if (!c.startsWith(`${UPSTREAM} &&`) && c !== UPSTREAM) problems.push(`${name}: if must start with "${UPSTREAM} &&" (has: ${cond ?? 'none'})`);
    } else if (on.includes('schedule') && c !== SCHEDULE_GUARD && !c.startsWith(`(${SCHEDULE_GUARD}) &&`)) {
      problems.push(`${name}: runs on the schedule; its if must be "${SCHEDULE_GUARD}" (has: ${cond ?? 'none'})`);
    }
  }
  return problems;
}

const ci = readFileSync(join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

test('ci.yml has the nightly schedule and live jobs to guard', () => {
  const { on, jobs } = readWorkflow(ci);
  assert.ok(on.includes('schedule'), `on: ${on}`);
  assert.deepEqual(Object.keys(jobs).filter(isLive), ['live-key', 'live']);
  assert.ok(Object.keys(jobs).includes('offline'));
});

test('every job in ci.yml carries the upstream guard', () => {
  assert.deepEqual(guardProblems(ci), []);
});

test('the guard check catches a missing or weakened guard', () => {
  const live = ci.replace(/( {4}if: )github\.repository == 'deepgram-devs\/voice-agent-workshop' && (needs\.live-key)/, '$1$2');
  assert.notEqual(live, ci);
  assert.match(guardProblems(live).join('\n'), /^live: if must start with/m);
  const offline = ci.replace(`    if: ${SCHEDULE_GUARD}\n`, '');
  assert.match(guardProblems(offline).join('\n'), /^offline: runs on the schedule/m);
  const ored = ci.replace(/ {4}if: >-\n {6}github\.repository == 'deepgram-devs\/voice-agent-workshop' &&\n {6}\(github\.event_name == 'schedule'/, "    if: >-\n      github.repository == 'x' || (github.event_name == 'schedule'");
  assert.notEqual(ored, ci);
  assert.match(guardProblems(ored).join('\n'), /^live-key: if must start with/m);
});

test('a folded if: >- reads as one line', () => {
  const { jobs } = readWorkflow('on:\n  push:\njobs:\n  a:\n    if: >-\n      x &&\n      y\n    runs-on: z\n');
  assert.equal(jobs.a.if, 'x && y');
});
