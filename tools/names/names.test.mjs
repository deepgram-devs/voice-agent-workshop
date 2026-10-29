// `node --test tools/names`: the standalone name scan. Every term here is a
// neutral placeholder, so the scanner's own files never trip a real list.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTerms, termMatcher, filesUnder, scan, scanText } from './names.mjs';

const SCRIPT = fileURLToPath(new URL('./names.mjs', import.meta.url));

test('a name matches across case, spaces, hyphens and underscores; an identifier matches as written and in camelCase', () => {
  const match = termMatcher(parseTerms(' secret name , wire_name ,, '));
  assert.equal(match('Join the Secret-Name list'), 'secret name');
  assert.equal(match('SpeakSecretNameEvent'), 'secret name');
  assert.equal(match('send wire_name here'), 'wire_name');
  assert.equal(match('const x = wireName'), 'wire_name');
  assert.equal(match('Wire name interval'), null);
  assert.equal(match('nothing to see'), null);
});

test('a name glued into a longer word is caught: hostnames, URL slugs, all-caps env names', () => {
  const match = termMatcher(['pine cone', 'ABCD']);
  assert.equal(match('see speakpinecone.com'), 'pine cone');
  assert.equal(match('https://example.com/docs/pineconeagent'), 'pine cone');
  assert.equal(match('PINECONE_URL=wss://x'), 'pine cone');
  assert.equal(match('export SDKPINECONEURL=1'), 'pine cone');
  assert.equal(match('myabcd'), 'ABCD');
  assert.equal(match('abcdconfig.json'), 'ABCD');
  assert.equal(match('SDKABCD'), 'ABCD');
  assert.equal(match('ABCDURL'), 'ABCD');
  assert.equal(match('pineConeFlag'), 'pine cone');
  assert.equal(match('two ABCDs'), 'ABCD');
  // The trade-off: a match across two words is a false positive, and it fails loudly.
  assert.equal(match('a spine coney'), 'pine cone');
  // Wrapped and concatenated glued forms.
  assert.deepEqual(scanText('a.md', 'host speakpine\ncone.example\n', match), [['a.md', 1, 'pine cone']]);
  assert.deepEqual(scanText('a.js', "const s = 'Pine' + 'Cone';\n", match), [['a.js', 1, 'pine cone']]);
});

test('the scan reports file and line, and skips lockfiles and audio', () => {
  const root = mkdtempSync(join(tmpdir(), 'names-'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'docs', 'a.md'), 'fine\na secret name line\n');
  writeFileSync(join(root, 'uv.lock'), 'secret name');
  writeFileSync(join(root, 'clip.wav'), 'secret name');
  const files = filesUnder(root);
  assert.deepEqual(files.sort(), [join('docs', 'a.md')]);
  assert.deepEqual(scan(root, files, termMatcher(['secret name'])), [[join('docs', 'a.md'), 2, 'secret name']]);
});

test('a term wrapped onto the next line is caught, at the line it starts on', () => {
  const match = termMatcher(['secret name']);
  // Hard-wrapped prose and a wrapped comment.
  assert.deepEqual(scanText('a.md', 'one\nthe secret\nname list\n', match), [['a.md', 2, 'secret name']]);
  assert.deepEqual(scanText('a.py', '# about the secret\n# name here\n', match), [['a.py', 1, 'secret name']]);
  assert.deepEqual(scanText('a.ts', '/*\n * the secret\n * name\n */\n', match), [['a.ts', 2, 'secret name']]);
  assert.deepEqual(scanText('a.html', '<!-- the secret\n-- name -->\n', match), [['a.html', 1, 'secret name']]);
  // String concatenation, across lines and inside one line.
  assert.deepEqual(scanText('a.ts', "const s = 'the secret ' +\n  'name list';\n", match), [['a.ts', 1, 'secret name']]);
  assert.deepEqual(scanText('a.js', "const s = 'Secret' + 'Name';\n", match), [['a.js', 1, 'secret name']]);
  // One hit per place: a term on one line isn't reported again for the pair.
  assert.deepEqual(scanText('a.md', 'a secret name\nnext line\n', match), [['a.md', 1, 'secret name']]);
  assert.deepEqual(scanText('a.md', 'secret\nplain\nname\n', match), []);
});

test('empty FORBIDDEN_TERMS: a local run skips, a CI run fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'names-empty-'));
  writeFileSync(join(root, 'a.md'), 'fine\n');
  const run = (env) => spawnSync(process.execPath, [SCRIPT, root], { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
  const local = run({ FORBIDDEN_TERMS: ' , ' });
  assert.equal(local.status, 0, local.stdout);
  assert.match(local.stdout, /skipped/);
  const ci = run({ CI: 'true', FORBIDDEN_TERMS: '' });
  assert.equal(ci.status, 1, ci.stdout);
  assert.match(ci.stdout, /FORBIDDEN_TERMS is empty in CI/);
  const scanned = run({ CI: 'true', FORBIDDEN_TERMS: 'zzq placeholder' });
  assert.equal(scanned.status, 0, scanned.stdout);
  assert.match(scanned.stdout, /1 term\(s\), 0 hit\(s\)/);
});
