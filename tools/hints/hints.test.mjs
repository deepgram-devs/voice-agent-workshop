// Tests for the hints `make check` and the Codespaces setup print. Run: make hints-test
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { envValue, nextStep, parseArgs, siteOf, webId } from './next-step.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a pass names the mission and the next command, with SDK= only when it was given', () => {
  const lines = nextStep('00-first-words');
  assert.ok(lines.includes('Mission 00 passes its offline check.'));
  assert.ok(lines.some((l) => l.startsWith('Next: make run 00 to talk to your agent')));
  assert.ok(!lines.some((l) => l.includes('map')), 'no map link without WORKSHOP_URL');
  assert.ok(nextStep('03-no-dead-air', { sdkArg: 'SDK=ts' }).some((l) => l.startsWith('Next: make run 03 SDK=ts ')));
});

test('a pass names the file it checked', () => {
  const lines = nextStep('00-first-words', { files: [{ name: 'Python', file: 'python/missions/00-first-words/start.py' }] });
  assert.equal(lines[1], 'Mission 00 passes its offline check: python/missions/00-first-words/start.py');
  assert.ok(!lines.includes('Mission 00 passes its offline check.'));
  assert.ok(lines.some((l) => l.startsWith('Next: make run 00 to talk to your agent')), 'no SDK= when none was given');
});

test('two files checked: one line each', () => {
  const lines = nextStep('01-let-me-finish', {
    sdkArg: 'SDK=py',
    files: [
      { name: 'Python', file: 'python/missions/01-let-me-finish/start.py' },
      { name: 'TypeScript', file: 'typescript/missions/01-let-me-finish/start.ts' },
    ],
  });
  assert.deepEqual(lines.slice(1, 4), [
    'Mission 01 passes its offline check: python/missions/01-let-me-finish/start.py',
    'Mission 01 passes its offline check: typescript/missions/01-let-me-finish/start.ts',
    'Next: make run 01 SDK=py to talk to your agent (type a line, press Enter; Ctrl-D or Ctrl-C hangs up). It needs DEEPGRAM_API_KEY or your workshop token in .env. Then make live 01 SDK=py runs the live check.',
  ]);
});

test('parseArgs reads SDK= and Name=path in any order', () => {
  assert.deepEqual(parseArgs(['Python=python/a.py', 'SDK=py']), { sdkArg: 'SDK=py', files: [{ name: 'Python', file: 'python/a.py' }] });
  assert.deepEqual(parseArgs(['SDK=ts']), { sdkArg: 'SDK=ts', files: [] });
  assert.deepEqual(parseArgs([]), { sdkArg: '', files: [] });
});

test('with WORKSHOP_URL set, a pass links the mission page on the workshop site, and says whose browser opens it', () => {
  const lines = nextStep('04-polyglot', { workshopUrl: 'wss://speak.example.test/sdk' });
  assert.deepEqual(lines.slice(-2), [
    'Then see it on your map: https://speak.example.test/m/polyglot#run-it (in the browser that has your handle; played on your phone? open https://speak.example.test/resume on this laptop first).',
    'On that page, tap I did this on "Your code passed make check 04".',
  ]);
  assert.equal(nextStep('00-first-words', { workshopUrl: 'ws://localhost:8091/sdk' }).at(-2), 'Then see it on your map: http://localhost:8091/m/first-words#run-it (in the browser that has your handle; played on your phone? open http://localhost:8091/resume on this laptop first).');
});

test('the next step says make run needs a credential, how to hang up, and that make live comes after; in Docker, the compose form', () => {
  const lines = nextStep('00-first-words');
  assert.equal(lines[2], 'Next: make run 00 to talk to your agent (type a line, press Enter; Ctrl-D or Ctrl-C hangs up). It needs DEEPGRAM_API_KEY or your workshop token in .env. Then make live 00 runs the live check.');
  assert.ok(!lines.some((l) => l.includes('docker compose')), 'no compose form outside Docker');
  const docker = nextStep('03-no-dead-air', { sdkArg: 'SDK=ts', inDocker: true });
  assert.equal(docker[2], 'Next: docker compose run --rm workshop make run 03 SDK=ts to talk to your agent (type a line, press Enter; Ctrl-D or Ctrl-C hangs up). It needs DEEPGRAM_API_KEY or your workshop token in .env. Then docker compose run --rm workshop make live 03 SDK=ts runs the live check.');
  // The script reads WORKSHOP_IN_DOCKER, as compose.yaml sets it.
  const env = { PATH: process.env.PATH, WORKSHOP_URL: '', WORKSHOP_IN_DOCKER: '1' };
  const out = spawnSync(process.execPath, [join(ROOT, 'tools/hints/next-step.mjs'), '00-first-words'], { env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^Next: docker compose run --rm workshop make run 00 to talk/m);
  assert.match(readFileSync(join(ROOT, 'compose.yaml'), 'utf8'), /WORKSHOP_IN_DOCKER: "1"/, 'compose.yaml sets it');
});

test('the Docker form names the service compose.yaml sets (workshop-java for Java)', () => {
  const java = nextStep('00-first-words', { inDocker: true, service: 'workshop-java' });
  assert.equal(java[2], 'Next: docker compose run --rm workshop-java make run 00 to talk to your agent (type a line, press Enter; Ctrl-D or Ctrl-C hangs up). It needs DEEPGRAM_API_KEY or your workshop token in .env. Then docker compose run --rm workshop-java make live 00 runs the live check.');
  assert.equal(nextStep('00-first-words', { inDocker: true })[2], nextStep('00-first-words', { inDocker: true, service: 'workshop' })[2], 'workshop is the default');
  // The script reads WORKSHOP_DOCKER_SERVICE, as compose.yaml sets it on the workshop-java service.
  const env = { PATH: process.env.PATH, WORKSHOP_URL: '', WORKSHOP_IN_DOCKER: '1', WORKSHOP_DOCKER_SERVICE: 'workshop-java' };
  const out = spawnSync(process.execPath, [join(ROOT, 'tools/hints/next-step.mjs'), '00-first-words'], { env, encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /^Next: docker compose run --rm workshop-java make run 00 to talk/m);
  const compose = readFileSync(join(ROOT, 'compose.yaml'), 'utf8');
  assert.match(compose, /^\s+workshop-java:$/m, 'compose.yaml has the service');
  assert.match(compose, /WORKSHOP_DOCKER_SERVICE: workshop-java/, 'and sets the name in it');
});

test('siteOf and webId', () => {
  assert.equal(siteOf('https://speak.example.test/sdk/'), 'https://speak.example.test');
  assert.equal(siteOf('wss://speak.example.test/builders-lab/sdk'), 'https://speak.example.test/builders-lab');
  assert.equal(siteOf('https://speak.example.test/builders-lab/code'), 'https://speak.example.test/builders-lab');
  assert.equal(siteOf('wss://speak.example.test/builders-lab/sdk/v1/agent/converse'), 'https://speak.example.test/builders-lab');
  assert.equal(siteOf('wss://speak.example.test?x=1'), 'https://speak.example.test');
  // A pasted mission page (or its step) or /resume names the site, not that page.
  assert.equal(siteOf('https://speak.example.test/builders-lab/m/first-words'), 'https://speak.example.test/builders-lab');
  assert.equal(siteOf('https://speak.example.test/builders-lab/m/let-me-finish/the-knobs/'), 'https://speak.example.test/builders-lab');
  assert.equal(siteOf('https://speak.example.test/resume'), 'https://speak.example.test');
  assert.equal(siteOf('speak.example.test/sdk'), '');
  assert.equal(siteOf(''), '');
  assert.equal(webId('06-encore'), 'encore');
  assert.equal(webId('05-mystery-guest'), 'mystery-guest');
});

test('envValue reads one variable from .env text, quoted or not, and nothing else', () => {
  const text = 'WORKSHOP_TOKEN=wst_secret\n# WORKSHOP_URL=wss://commented.example.test/sdk\nWORKSHOP_URL="wss://speak.example.test/sdk" \nOTHER=1';
  assert.equal(envValue(text, 'WORKSHOP_URL'), 'wss://speak.example.test/sdk');
  assert.equal(envValue('WORKSHOP_URL=wss://a.example.test/sdk # from /code', 'WORKSHOP_URL'), 'wss://a.example.test/sdk');
  assert.equal(envValue('WORKSHOP_URL=', 'WORKSHOP_URL'), '');
  assert.equal(envValue('', 'WORKSHOP_URL'), '');
});

test('the script prints the next step and never the token', () => {
  const env = { PATH: process.env.PATH, WORKSHOP_URL: 'wss://speak.example.test/sdk', WORKSHOP_TOKEN: 'wst_hints-test-token-000000' };
  const args = ['02-read-the-room', 'SDK=py', 'Python=python/missions/02-read-the-room/start.py'];
  const out = spawnSync(process.execPath, [join(ROOT, 'tools/hints/next-step.mjs'), ...args], { env, encoding: 'utf8' });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /Mission 02 passes its offline check: python\/missions\/02-read-the-room\/start\.py/);
  assert.match(out.stdout, /Next: make run 02 SDK=py /);
  assert.match(out.stdout, /https:\/\/speak\.example\.test\/m\/read-the-room/);
  assert.ok(!out.stdout.includes('wst_'));
});

test('the script runs when started through a symlinked folder (Node sees the real path)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hints-link-'));
  try {
    symlinkSync(join(ROOT, 'tools'), join(dir, 'tools'), 'dir');
    const args = ['00-first-words', 'Python=python/missions/00-first-words/start.py'];
    const out = spawnSync(process.execPath, [join(dir, 'tools/hints/next-step.mjs'), ...args], { env: { PATH: process.env.PATH, WORKSHOP_URL: '' }, encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /Mission 00 passes its offline check: python\/missions\/00-first-words\/start\.py/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

function keyNote(env) {
  return spawnSync('bash', [join(ROOT, '.devcontainer/key-note.sh')], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
}

test('Codespaces: a DEEPGRAM_API_KEY secret gets a note that a workshop token in .env is used instead', () => {
  const out = keyNote({ DEEPGRAM_API_KEY: 'dg-hints-test-not-a-key' });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /Codespaces secret is set/);
  assert.match(out.stdout, /missions run on your own key/);
  assert.match(out.stdout, /the token is used/);
  assert.ok(!out.stdout.includes('dg-hints-test-not-a-key'), 'the key itself is never printed');
  assert.match(out.stdout, /Then pick your language with the line below, and run make check 00\./);
  assert.doesNotMatch(out.stdout, /make run 00/, 'no run before a language is picked');
});

test('Codespaces: with no secret, the note says where a key or a token goes', () => {
  const out = keyNote({});
  assert.equal(out.status, 0);
  assert.match(out.stdout, /Put DEEPGRAM_API_KEY in \.env/);
  assert.doesNotMatch(out.stdout, /secret is set/);
  assert.match(out.stdout, /Then pick your language with the line below, and run make check 00\./);
  assert.doesNotMatch(out.stdout, /make run 00/, 'no run before a language is picked');
});

test('Codespaces: post-create.sh ends on make use, so its last line is the language or how to pick one', () => {
  const lines = readFileSync(join(ROOT, '.devcontainer/post-create.sh'), 'utf8').trim().split('\n');
  assert.equal(lines.at(-1), 'make --no-print-directory use');
  assert.ok(lines.includes('make setup USE_HINT=0'), 'setup leaves the pick line to the end');
});

test('WORKSHOP_URL set in the shell wins over .env, even empty (no site), so a developer\'s .env never reaches these tests', () => {
  // A private copy of the script beside its own .env: the script reads the .env two folders up from itself.
  const dir = mkdtempSync(join(tmpdir(), 'hints-env-'));
  try {
    mkdirSync(join(dir, 'tools/hints'), { recursive: true });
    copyFileSync(join(ROOT, 'tools/hints/next-step.mjs'), join(dir, 'tools/hints/next-step.mjs'));
    writeFileSync(join(dir, '.env'), 'DEEPGRAM_API_KEY=\nWORKSHOP_URL=wss://example.test/sdk\n');
    const run = (env) => spawnSync(process.execPath, [join(dir, 'tools/hints/next-step.mjs'), '00-first-words'], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8' });
    const fromFile = run({});
    assert.equal(fromFile.status, 0, fromFile.stderr);
    assert.match(fromFile.stdout, /Then see it on your map: https:\/\/example\.test\/m\/first-words#run-it/, 'unset in the shell: .env fills it');
    const empty = run({ WORKSHOP_URL: '' });
    assert.equal(empty.status, 0, empty.stderr);
    assert.ok(!empty.stdout.includes('your map'), `set and empty: no site line\n${empty.stdout}`);
    const shell = run({ WORKSHOP_URL: 'wss://shell.test/sdk' });
    assert.match(shell.stdout, /https:\/\/shell\.test\/m\/first-words#run-it/, 'the shell wins over .env');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
