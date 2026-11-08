// node --test tools/ci/github-files.test.mjs
//
// CODEOWNERS names an owner for each track, and the two issue forms exist with the fields
// the workshop site links to: "Report a mistake" with a page-url field, and "List your event".
// The forms' full schema check runs outside this repo's tests (GitHub's issue-forms schema).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';

const ROOT = resolve(import.meta.dirname, '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

test('CODEOWNERS has a default owner and a line per track', () => {
  const lines = read('.github', 'CODEOWNERS').split('\n').filter((l) => l.trim() && !l.startsWith('#'));
  const owners = Object.fromEntries(lines.map((l) => l.trim().split(/\s+/)).map(([path, ...who]) => [path, who]));
  for (const path of ['*', '/python/', '/typescript/', '/java/']) {
    assert.ok(owners[path]?.length, `no owner for ${path}`);
    for (const who of owners[path]) assert.match(who, /^@[\w-]+(\/[\w-]+)?$/, `${path}: ${who}`);
  }
});

test('Report a mistake has a required page-url field', () => {
  const form = read('.github', 'ISSUE_TEMPLATE', 'report-a-mistake.yml');
  assert.match(form, /^name: Report a mistake$/m);
  assert.match(form, /^ {4}id: page-url$/m);
  const block = form.slice(form.indexOf('id: page-url'));
  assert.match(block.slice(0, block.indexOf('\n  - ')), /required: true/);
});

test('List your event exists', () => {
  assert.match(read('.github', 'ISSUE_TEMPLATE', 'list-your-event.yml'), /^name: List your event$/m);
});
