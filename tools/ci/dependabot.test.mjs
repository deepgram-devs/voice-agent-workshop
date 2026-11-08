// node --test tools/ci/dependabot.test.mjs
//
// .github/dependabot.yml covers each track's ecosystem, the check harness, github-actions and
// docker, and every updates: entry sets target-branch: main, so no update ever aims at the
// release branch (the default branch "Use this template" copies).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..', '..');

/** The updates: entries, each as { ecosystem, directory, targetBranch }, read by indentation. */
export function readUpdates(text) {
  const entries = [];
  let cur = null;
  let inUpdates = false;
  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) inUpdates = /^updates:\s*$/.test(line);
    if (!inUpdates) continue;
    const start = /^ {2}- package-ecosystem:\s*"?([\w-]+)"?\s*$/.exec(line);
    if (start) {
      cur = { ecosystem: start[1], directory: null, targetBranch: null };
      entries.push(cur);
      continue;
    }
    if (/^ {2}- /.test(line)) {
      cur = { ecosystem: null, directory: null, targetBranch: null };
      entries.push(cur);
    }
    const kv = /^ {4}([\w-]+):\s*"?([^"#\s]*)"?\s*(?:#.*)?$/.exec(line);
    if (cur && kv) {
      if (kv[1] === 'directory') cur.directory = kv[2];
      if (kv[1] === 'target-branch') cur.targetBranch = kv[2];
      if (kv[1] === 'package-ecosystem') cur.ecosystem = kv[2];
    }
  }
  return entries;
}

const text = readFileSync(join(ROOT, '.github', 'dependabot.yml'), 'utf8');

test('every updates: entry sets target-branch: main', () => {
  const entries = readUpdates(text);
  assert.ok(entries.length >= 6, `${entries.length} entries`);
  for (const e of entries) assert.equal(e.targetBranch, 'main', `${e.ecosystem} ${e.directory}`);
  // Every "- " item under updates: was read as an entry (none skipped by the reader).
  assert.equal(entries.length, (text.match(/^ {2}- /gm) ?? []).length);
});

test('each track, the harness, github-actions and docker are covered', () => {
  const have = readUpdates(text).map((e) => `${e.ecosystem} ${e.directory}`);
  for (const want of ['uv /python', 'npm /typescript', 'maven /java', 'npm /tools/replay-server', 'github-actions /', 'docker /']) {
    assert.ok(have.includes(want), `missing ${want} (have: ${have.join(', ')})`);
  }
});

test('the reader catches a missing target-branch', () => {
  const without = text.replace(/(directory: \/java\n) {4}target-branch: main\n/, '$1');
  assert.notEqual(without, text);
  const java = readUpdates(without).find((e) => e.directory === '/java');
  assert.equal(java.targetBranch, null);
});
