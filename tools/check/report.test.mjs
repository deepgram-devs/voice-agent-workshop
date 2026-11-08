// `make check-json-test`: FORMAT=json output. The parser runs on output captured from the
// three tracks; the end-to-end test runs `make check 00 FORMAT=json` for the track in $SDK
// (CI sets it per leg) on the start file (a fail) and on the reference answer (a pass).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildReport, notYetReport, stopReport } from './report.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const contract = JSON.parse(readFileSync(resolve(HERE, 'errors.json'), 'utf8'));

// The part of errors.json this tool uses: validate a value against a schema node.
function validate(node, value, path = '$') {
  const errs = [];
  if (node.$ref) return validate(contract.$defs[node.$ref.replace('#/$defs/', '')], value, path);
  if (node.type === 'object') {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [`${path}: not an object`];
    for (const k of node.required ?? []) if (!(k in value)) errs.push(`${path}.${k}: missing`);
    for (const [k, v] of Object.entries(value)) {
      if (node.properties?.[k]) errs.push(...validate(node.properties[k], v, `${path}.${k}`));
      else if (node.additionalProperties === false) errs.push(`${path}.${k}: not allowed`);
    }
  } else if (node.type === 'string') {
    if (typeof value !== 'string') return [`${path}: not a string`];
    if (node.minLength && value.length < node.minLength) errs.push(`${path}: empty`);
    if (node.pattern && !new RegExp(node.pattern).test(value)) errs.push(`${path}: pattern ${node.pattern}`);
  } else if (node.type === 'boolean') {
    if (typeof value !== 'boolean') errs.push(`${path}: not a boolean`);
  }
  return errs;
}

function assertReport(r) {
  assert.equal(typeof r.ok, 'boolean');
  assert.ok(Array.isArray(r.checks) && Array.isArray(r.errors));
  for (const [i, e] of r.errors.entries()) {
    assert.deepEqual(validate(contract.$defs.errorBody, e, `errors[${i}]`), []);
    for (const k of ['code', 'message', 'hint', 'doc_url', 'retryable']) assert.ok(k in e.error, `error has ${k}`);
  }
}

const FAIL_OUTPUT = `00-first-words replay "greeting"
  PASS  Settings is the first message you send
  FAIL  TODO 1: the prompt is your own, not the starter one
  FAIL  TODO 3: agent.greeting is set
Your file: python/missions/00-first-words/start.py:13 (TODO 1)
`;

test('a failing check: one error per FAIL line, in the errors.json shape', () => {
  const r = buildReport({ track: 'py', mission: '00-first-words', status: 1, again: 'make check 00', output: FAIL_OUTPUT });
  assertReport(r);
  assert.equal(r.ok, false);
  assert.equal(r.errors.length, 2);
  assert.equal(r.errors[0].error.code, 'CHECK_FAILED');
  assert.equal(r.errors[0].error.message, 'TODO 1: the prompt is your own, not the starter one');
  assert.equal(r.errors[0].error.step.mission, '00-first-words');
  assert.equal(r.checks.find((c) => c.todo === 1).line, 13);
});

test('TypeScript output with colour codes parses the same', () => {
  const colour = FAIL_OUTPUT.replace('  FAIL  TODO 1', '\u001b[31m  FAIL  TODO 1').replace('starter one', 'starter one\u001b[39m');
  const r = buildReport({ track: 'ts', mission: '00-first-words', status: 1, output: `CheckFailed: ${colour}` });
  assert.equal(r.errors.length, 2);
  assert.ok(!JSON.stringify(r).includes('\u001b'));
});

test('a pass: ok, no errors', () => {
  const r = buildReport({ track: 'java', mission: '00-first-words', status: 0, output: '' });
  assertReport(r);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, []);
});

test('a failed exit with no FAIL line is VERIFIER_ERROR, retryable', () => {
  const r = buildReport({ track: 'py', mission: '00-first-words', status: 1, output: 'SyntaxError: invalid syntax' });
  assertReport(r);
  assert.equal(r.errors[0].error.code, 'VERIFIER_ERROR');
  assert.equal(r.errors[0].error.retryable, true);
});

test('a stop before any check and a language with no check yet are valid too', () => {
  assertReport(stopReport({ message: 'Pick your language first: make use py (Python)', mission: '00-first-words', again: 'make check 00' }));
  assertReport(stopReport({ message: 'Which mission?' }));
  const n = notYetReport({ track: 'java', mission: '03-no-dead-air', message: 'Java has no mission 03 yet.' });
  assertReport(n);
  assert.equal(n.errors[0].error.code, 'CHECKPOINT_NOT_FOUND');
});

function make(args) {
  return spawnSync('make', ['--no-print-directory', 'check', '00', 'FORMAT=json', ...args], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
}

for (const target of ['start', 'solution']) {
  test(`make check 00 FORMAT=json, ${target} file, track from SDK`, { skip: process.env.SDK ? false : 'set SDK=py, ts or java' }, () => {
    const p = make([`SDK=${process.env.SDK}`, ...(target === 'solution' ? ['MISSION_TARGET=solution'] : [])]);
    const lines = p.stdout.split('\n').filter(Boolean);
    assert.equal(lines.length, 1, `one JSON line on stdout, got: ${p.stdout.slice(0, 300)}`);
    const r = JSON.parse(lines[0]);
    assertReport(r);
    assert.equal(r.track, process.env.SDK);
    assert.equal(r.ok, target === 'solution');
    assert.equal(p.status === 0, target === 'solution', 'the exit code is the check result');
    if (target === 'start') assert.ok(r.errors.some((e) => e.error.code === 'CHECK_FAILED'));
  });
}

test('FORMAT=xml stops with one line', () => {
  const p = make(['FORMAT=xml']);
  assert.notEqual(p.status, 0);
  assert.match(p.stdout, /isn't a format/);
});
