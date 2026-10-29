// Line endings in a Windows clone. Run: make make-test
//
// Git for Windows clones with core.autocrlf=true, which turns every text file
// CRLF unless .gitattributes says otherwise, and a CRLF .devcontainer script
// stops on `pipefail\r`. This test commits the tracked files into a fresh temp
// repo (so only this project's .gitattributes applies), clones it with
// core.autocrlf=true, and reads the bytes that land: every text file is LF, .cmd
// and .bat files are CRLF. Outside a git checkout it skips, except in CI (CI set), where a
// checkout git won't read (a container job's "dubious ownership") fails instead.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const temp = mkdtempSync(join(tmpdir(), 'eol-test-'));
after(() => rmSync(temp, { recursive: true, force: true }));

// No global or system git config: only the -c settings below and .gitattributes count.
const GIT_ENV = { ...process.env, HOME: temp, GIT_CONFIG_GLOBAL: join(temp, 'none'), GIT_CONFIG_NOSYSTEM: '1' };
function git(cwd, ...args) {
  const out = spawnSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8' });
  if (out.status !== 0) throw new Error(`git ${args.join(' ')}: ${out.stderr || out.error}`);
  return out.stdout;
}

const listed = spawnSync('git', ['-C', ROOT, 'ls-files', '-z'], { encoding: 'utf8' });
const tracked = listed.status === 0 ? listed.stdout.split('\0').filter((f) => f && existsSync(join(ROOT, f))) : [];

test('a Windows clone (core.autocrlf=true) checks out every text file LF, and .cmd and .bat files CRLF', { skip: tracked.length === 0 && !process.env.CI && 'not a git checkout' }, () => {
  assert.ok(tracked.length > 0, `git ls-files found no files here: ${listed.stderr || listed.error}`);
  const src = join(temp, 'src');
  for (const f of tracked) {
    mkdirSync(dirname(join(src, f)), { recursive: true });
    copyFileSync(join(ROOT, f), join(src, f));
  }
  writeFileSync(join(src, 'eol-test.cmd'), '@echo off\necho hello\n');
  writeFileSync(join(src, 'eol-test.bat'), '@echo off\r\n');
  git(src, 'init', '-q');
  git(src, 'add', '-A');
  git(src, '-c', 'user.name=eol-test', '-c', 'user.email=eol-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'eol test');

  const clone = join(temp, 'clone');
  git(temp, '-c', 'core.autocrlf=true', 'clone', '-q', src, clone);

  for (const f of ['Makefile', '.devcontainer/post-create.sh', '.devcontainer/key-note.sh']) {
    assert.ok(!readFileSync(join(clone, f), 'latin1').includes('\r'), `${f} has CR in a Windows clone`);
  }
  const crlf = git(clone, 'ls-files', '--eol').split('\n').filter((l) => /\bw\/(crlf|mixed)\b/.test(l));
  const crlfPaths = crlf.map((l) => l.split('\t').at(-1));
  assert.deepEqual(crlfPaths.filter((f) => !/\.(cmd|bat)$/i.test(f)), [], `CRLF files in a Windows clone:\n${crlf.join('\n')}`);
  assert.ok(crlfPaths.includes('eol-test.cmd'), `eol-test.cmd is not CRLF:\n${crlf.join('\n')}`);
  assert.ok(crlfPaths.includes('eol-test.bat'), `eol-test.bat is not CRLF:\n${crlf.join('\n')}`);
  assert.ok(readFileSync(join(clone, 'eol-test.cmd'), 'latin1').includes('\r\n'), '.cmd files keep CRLF');
});
