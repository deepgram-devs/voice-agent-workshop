// Tests for the Makefile's language choice (`make use`, SDK=, .workshop-lang). Run: make make-test
//
// Each test copies the Makefile into a temp folder with an empty mission and runs
// the real make against stub uv, pnpm and npm that print `STUB <tool> <args>`, so
// it checks which language a command picks without installing either one. The
// child gets a PATH of only those stubs and the few host tools the recipes use, and
// none of this shell's SDK, MAKEFLAGS or MISSION_TARGET (CI runs `make ci` with SDK set).
// MAKE_BIN picks the make to test; the make-test target passes its own.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, isAbsolute, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { nodeTooOld } from '../replay-server/lib/node-version.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST_TOOLS = ['echo', 'head', 'tr', 'cut', 'rm', 'cat', 'awk', 'sed', 'grep', 'sort', 'cp', 'mkdir', 'env', 'sh', 'uname'];

// The lines that list every language come from the Makefile's LISTED_LANGS, AUTO_LANGS
// and NAME_<id> (TOOL_, HOW_), so a new language block keeps these tests green.
const MAKEFILE = readFileSync(join(ROOT, 'Makefile'), 'utf8');
function mvar(name) {
  const m = new RegExp(`^${name}\\s*:?=\\s*(.*)$`, 'm').exec(MAKEFILE);
  if (!m) throw new Error(`${name} is not set in the Makefile`);
  return m[1].trim();
}
const LANGS = mvar('LANGS').split(/\s+/);
const AUTO_LANGS = mvar('AUTO_LANGS').split(/\s+/);
const LISTED = mvar('LISTED_LANGS').split(/\s+/);
const NAME = Object.fromEntries(LANGS.map((l) => [l, mvar(`NAME_${l}`)]));
// "A", "A or B", "A, B or C", as the Makefile's say_list writes a list.
const orList = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);
const PICK_LIST = orList(LISTED.map((l) => `make use ${l} (${NAME[l]})`));
const PICK = `Pick your language first: ${PICK_LIST}`;
const switchFrom = (saved) => orList(LISTED.filter((l) => l !== saved).map((l) => `make use ${l}`));
const sdkList = orList(LISTED.map((l) => `SDK=${l}`));
// HOW_java depends on where make runs (adoptium.net, or apt in Codespaces and the dev
// container), so it's spelled out here; the tests run make with neither variable set.
const JDK_SITE = 'https://adoptium.net';
const JDK_APT = 'sudo apt-get update && sudo apt-get install -y openjdk-21-jdk-headless';
const how = (l) => (l === 'java' ? JDK_SITE : mvar(`HOW_${l}`));
const EXTRA = LISTED.filter((l) => !AUTO_LANGS.includes(l));
const INSTALL = orList(AUTO_LANGS.map((l) => `${mvar(`TOOL_${l}`)} (${NAME[l]}, ${how(l)})`));
const NONE_BASE = `To run a mission, install ${INSTALL}, then run make setup.`;
const extraUse = (l) => ` For ${NAME[l]}: with ${mvar(`TOOL_${l}`)} (${how(l)}), run make use ${l}, then make setup.`;
const NONE = NONE_BASE + EXTRA.map(extraUse).join('');
// A repo gate ignores the saved language: its Java clause names SDK= instead.
const noneRepo = (goal) => NONE_BASE + EXTRA.map((l) => ` For ${NAME[l]}: make ${goal} SDK=${l}.`).join('');
const NEEDS_PNPM = "TypeScript needs pnpm (npm install -g pnpm@10), which isn't installed. Install it, then run make setup.";

function onPath(name) {
  if (isAbsolute(name)) return name;
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    const full = join(dir, name);
    if (dir && existsSync(full)) return full;
  }
  throw new Error(`${name} is not on the PATH`);
}

const MAKE = onPath(process.env.MAKE_BIN || 'make');
const temps = [];
after(() => temps.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

/** A temp copy of the project's make surface, with stubs for the tools in `stubs`. */
function fixture(stubs = ['uv', 'pnpm']) {
  const dir = mkdtempSync(join(tmpdir(), 'make-test-'));
  temps.push(dir);
  copyFileSync(join(ROOT, 'Makefile'), join(dir, 'Makefile'));
  copyFileSync(join(ROOT, '.env.example'), join(dir, '.env.example'));
  for (const sub of ['missions/00-first-words', 'python', 'typescript/node_modules/.bin', 'tools/replay-server', 'tools/hints', 'bin']) mkdirSync(join(dir, sub), { recursive: true });
  writeFileSync(join(dir, 'missions/00-first-words/check.mjs'), '');
  // The Makefile's READY_ts probe: TypeScript reads as set up until a test removes this.
  writeFileSync(join(dir, 'typescript/node_modules/.bin/vitest'), '');
  chmodSync(join(dir, 'typescript/node_modules/.bin/vitest'), 0o755);
  // The Makefile's HARNESS_READY probe: the harness reads as installed until a test removes this.
  mkdirSync(join(dir, 'tools/replay-server/node_modules/ws'), { recursive: true });
  writeFileSync(join(dir, 'tools/replay-server/node_modules/ws/package.json'), '{}');
  copyFileSync(join(ROOT, 'tools/hints/next-step.mjs'), join(dir, 'tools/hints/next-step.mjs'));
  symlinkSync(MAKE, join(dir, 'bin/make'));
  symlinkSync(process.execPath, join(dir, 'bin/node'));
  for (const tool of HOST_TOOLS) symlinkSync(onPath(tool), join(dir, 'bin', tool));
  for (const tool of ['npm', ...stubs]) {
    // STUB_EXIT_<tool> fails one tool; STUB_EXIT fails them all.
    // STUB_OUT_<tool> is text the stub prints after its STUB line (tsc-shaped output, say).
    writeFileSync(join(dir, 'bin', tool), `#!/bin/sh\necho "STUB ${tool} $*"\n[ -n "\${STUB_OUT_${tool}:-}" ] && printf '%s\\n' "\${STUB_OUT_${tool}}"\n[ -n "\${WORKSHOP_AGAIN:-}" ] && echo "ENV ${tool} WORKSHOP_AGAIN=\${WORKSHOP_AGAIN}"\nexit \${STUB_EXIT_${tool}:-\${STUB_EXIT:-0}}\n`);
    chmodSync(join(dir, 'bin', tool), 0o755);
  }
  return dir;
}

/** Runs make in `dir` with an environment built from scratch: PATH, HOME and `env`. */
function make(dir, args, env = {}) {
  const out = spawnSync(join(dir, 'bin/make'), ['--no-print-directory', ...args], {
    cwd: dir,
    env: { PATH: join(dir, 'bin'), HOME: dir, ...env },
    encoding: 'utf8',
  });
  const text = `${out.stdout}${out.stderr}`;
  return { status: out.status, text, lines: text.trim().split('\n'), stubs: text.split('\n').filter((l) => l.startsWith('STUB ')) };
}

const save = (dir, text) => writeFileSync(join(dir, '.workshop-lang'), text);
const saved = (dir) => readFileSync(join(dir, '.workshop-lang'), 'utf8');
const ranPython = (r) => r.stubs.some((l) => l.startsWith('STUB uv '));
const ranTypeScript = (r) => r.stubs.some((l) => l.startsWith('STUB pnpm '));

test('a) both tools, nothing picked: check stops on the pick line and runs nothing', () => {
  const r = make(fixture(), ['check', '00']);
  assert.equal(r.status, 2);
  assert.ok(r.lines.includes(PICK), r.text);
  assert.deepEqual(r.stubs, []);
});

test('b) one tool, nothing picked: still the pick line (a tool on the PATH is not a choice)', () => {
  const r = make(fixture(['uv']), ['check', '00']);
  assert.equal(r.status, 2);
  assert.ok(r.lines.includes(PICK), r.text);
  assert.deepEqual(r.stubs, []);
});

test('c) make use ts saves ts; check runs TypeScript only and names the file; make use shows it', () => {
  const dir = fixture();
  const use = make(dir, ['use', 'ts']);
  assert.equal(use.status, 0, use.text);
  assert.equal(saved(dir), 'ts\n');
  assert.ok(use.lines.includes('Saved: TypeScript. make check, run and live use it now. Add SDK=py to run one command in Python.'), use.text);

  const r = make(dir, ['check', '00']);
  assert.equal(r.status, 0, r.text);
  assert.ok(ranTypeScript(r) && !ranPython(r), r.text);
  assert.ok(r.lines.includes('Checking your TypeScript file: typescript/missions/00-first-words/start.ts'), r.text);
  assert.ok(r.lines.includes('PASS  TypeScript (tsc): typescript/missions/00-first-words/start.ts typechecks'), r.text);
  assert.ok(r.lines.includes('Mission 00 passes its offline check: typescript/missions/00-first-words/start.ts'), r.text);
  assert.ok(r.lines.some((l) => l.startsWith('Next: make run 00 to talk')), r.text);

  const status = make(dir, ['use']);
  assert.equal(status.status, 0);
  assert.deepEqual(status.lines, [`Your language: TypeScript (saved in .workshop-lang). To switch: ${switchFrom('ts')}`]);
});

test('d) SDK=py in the environment or on the command line runs Python for that command, over a saved ts', () => {
  const dir = fixture();
  save(dir, 'ts\n');
  for (const r of [make(dir, ['check', '00'], { SDK: 'py' }), make(dir, ['check', '00', 'SDK=py'])]) {
    assert.equal(r.status, 0, r.text);
    assert.ok(ranPython(r) && !ranTypeScript(r), r.text);
    assert.ok(r.lines.includes('Checking your Python file: python/missions/00-first-words/start.py'), r.text);
    assert.ok(r.lines.some((l) => l.startsWith('Next: make run 00 SDK=py to talk')), r.text);
  }
  assert.equal(saved(dir), 'ts\n', 'SDK never changes the saved choice');
});

test('e) make use with a word that is no language stops and leaves the file alone', () => {
  const dir = fixture();
  save(dir, 'py\n');
  const r = make(dir, ['use', 'rust']);
  assert.equal(r.status, 2);
  assert.ok(r.lines.includes(`make use takes ${orList(LISTED)} (you typed rust).`), r.text);
  assert.equal(saved(dir), 'py\n');
});

test('f) .workshop-lang: CRLF and aliases read fine; a word that is no language stops with what it says', () => {
  const dir = fixture();
  save(dir, 'typescript\r\n');
  const ok = make(dir, ['check', '00']);
  assert.equal(ok.status, 0, ok.text);
  assert.ok(ranTypeScript(ok) && !ranPython(ok), ok.text);

  save(dir, 'rust');
  const bad = make(dir, ['check', '00']);
  assert.equal(bad.status, 2);
  assert.ok(bad.lines.includes(`.workshop-lang says "rust", which isn't a language here. Pick again: ${PICK_LIST}`), bad.text);
  assert.deepEqual(bad.stubs, []);

  save(dir, '\n  \n');
  const empty = make(dir, ['check', '00']);
  assert.equal(empty.status, 2);
  assert.ok(empty.lines.includes(`.workshop-lang is empty. Pick again: ${PICK_LIST}`), empty.text);

  save(dir, '$(shell touch pwned) ts\n');
  const odd = make(dir, ['check', '00']);
  assert.equal(odd.status, 2);
  assert.equal(existsSync(join(dir, 'pwned')), false, 'the file is read as text, never as make code');

  save(dir, '\n py ts\n');
  const two = make(dir, ['use']);
  assert.equal(two.status, 0, 'make use with no language never fails');
  assert.ok(two.lines.includes(`.workshop-lang says "py ts", which isn't a language here. Pick again: ${PICK_LIST}`), two.text);
});

test('g) repo gates ignore the saved choice: ci-solutions checks every installed language\'s reference solution', () => {
  const dir = fixture();
  save(dir, 'py\n');
  const r = make(dir, ['ci-solutions']);
  assert.equal(r.status, 0, r.text);
  assert.ok(ranPython(r) && ranTypeScript(r), r.text);
  assert.ok(!r.text.includes(PICK));
  assert.ok(r.lines.includes('Checking the Python reference answer: python/missions/00-first-words/solution.py'), r.text);
  assert.ok(r.lines.includes('Checking the TypeScript reference answer: typescript/missions/00-first-words/solution.ts'), r.text);
  assert.ok(!r.text.includes('passes its offline check'), 'no next-step hint for a solution');

  const unit = make(dir, ['unit']);
  assert.equal(unit.status, 0, unit.text);
  assert.ok(unit.lines.includes('Testing the Python helpers: python/agent') && unit.lines.includes('Testing the TypeScript helpers: typescript/src'), unit.text);
});

test('h) make run runs one language at a time', () => {
  const r = make(fixture(), ['run', '00', 'SDK=py ts']);
  assert.equal(r.status, 2);
  assert.ok(r.lines.includes('make run runs one language at a time: make run 00 SDK=py or make run 00 SDK=ts'), r.text);
  assert.deepEqual(r.stubs, []);
  const three = make(javaFixture(), ['run', '00', 'SDK=py ts java']);
  assert.equal(three.status, 2);
  const runOne = 'make run 00 SDK=py, make run 00 SDK=ts or make run 00 SDK=java';
  assert.ok(three.lines.includes(`make run runs one language at a time: ${runOne}`), three.text);

  const dir = fixture();
  save(dir, 'ts\n');
  const one = make(dir, ['run', '00']);
  assert.equal(one.status, 0, one.text);
  assert.ok(one.lines.includes('Running your TypeScript file: typescript/missions/00-first-words/start.ts'), one.text);
  assert.deepEqual(one.stubs, ['STUB pnpm -s tsx missions/00-first-words/start.ts']);
});

test('i) SDK=all checks every installed language, each once', () => {
  const r = make(fixture(), ['check', '00', 'SDK=all py']);
  assert.equal(r.status, 0, r.text);
  assert.equal(r.lines.filter((l) => l.startsWith('Checking your ')).length, 2, r.text);
  assert.ok(r.lines.some((l) => l.startsWith('Next: make run 00 SDK=py to talk')), 'two languages checked: the next command picks one');
});

test('j) make help and make use work before anything is picked', () => {
  const dir = fixture();
  const help = make(dir, ['help']);
  assert.equal(help.status, 0, help.text);
  assert.match(help.text, /make use py/);
  assert.match(help.text, /Missions with checks: 00-first-words/);
  const use = make(dir, ['use']);
  assert.equal(use.status, 0);
  assert.deepEqual(use.lines, [PICK]);
  assert.equal(existsSync(join(dir, '.workshop-lang')), false);
});

test('k) make setup with nothing picked installs every language it can and ends on the pick line', () => {
  const dir = fixture();
  const r = make(dir, ['setup']);
  assert.equal(r.status, 0, r.text);
  assert.ok(r.stubs.includes('STUB uv sync') && r.stubs.includes('STUB pnpm install --frozen-lockfile'), r.text);
  assert.ok(r.stubs.includes('STUB npm ci --no-audit --no-fund'), r.text);
  assert.equal(r.lines.at(-1), PICK);
  assert.ok(existsSync(join(dir, '.env')));

  save(dir, 'ts\n');
  const again = make(dir, ['setup']);
  assert.ok(again.stubs.includes('STUB uv sync'), 'a saved choice never narrows setup, so switching later works');
  assert.equal(again.lines.at(-1), `Your language: TypeScript (saved in .workshop-lang). To switch: ${switchFrom('ts')}`);

  const one = make(dir, ['setup', 'SDK=py']);
  assert.ok(one.stubs.includes('STUB uv sync') && !one.stubs.includes('STUB pnpm install --frozen-lockfile'), one.text);

  const quiet = make(fixture(), ['setup', 'USE_HINT=0']);
  assert.ok(!quiet.text.includes(PICK));

  const half = make(fixture(['uv']), ['setup']);
  assert.equal(half.status, 0);
  assert.ok(half.lines.includes('Skipping TypeScript: it needs pnpm (npm install -g pnpm@10).'), half.text);
});

test('l) a saved language whose tool is missing stops with the install line; make use saves it anyway', () => {
  const dir = fixture(['uv']);
  const use = make(dir, ['use', 'ts']);
  assert.equal(use.status, 0);
  assert.equal(saved(dir), 'ts\n');
  assert.ok(use.lines.includes(NEEDS_PNPM), use.text);
  const r = make(dir, ['check', '00']);
  assert.equal(r.status, 2);
  assert.ok(r.lines.includes(NEEDS_PNPM), r.text);
  assert.deepEqual(r.stubs, []);
  // make setup still sets up what it can and creates .env, then stops on the saved language it skipped.
  const setup = make(dir, ['setup']);
  assert.equal(setup.status, 2, setup.text);
  assert.ok(setup.stubs.includes('STUB uv sync'), setup.text);
  assert.ok(existsSync(join(dir, '.env')));
  assert.equal(setup.lines.at(-2), NEEDS_PNPM, 'the needs line is the last thing before make\'s own Error 2');
  assert.ok(!setup.text.includes('Your language:'), 'no status line after the stop');
  // With nothing saved, a skipped language is a line, and setup ends on the pick line as before.
  const fresh = make(fixture(['uv']), ['setup']);
  assert.equal(fresh.status, 0, fresh.text);
  assert.equal(fresh.lines.at(-1), PICK);
});

test('m) make use python, typescript, Python and TypeScript save the short id, with no "is up to date" line', () => {
  const dir = fixture();
  const r = make(dir, ['use', 'python']);
  assert.equal(r.status, 0);
  assert.equal(saved(dir), 'py\n');
  assert.doesNotMatch(r.text, /up to date|Nothing to be done/);
  make(dir, ['use', 'typescript']);
  assert.equal(saved(dir), 'ts\n');
  // The names the pick line shows work too, and the file always gets the short id.
  make(dir, ['use', 'Python']);
  assert.equal(saved(dir), 'py\n');
  make(dir, ['use', 'TypeScript']);
  assert.equal(saved(dir), 'ts\n');
  const bySdk = make(dir, ['check', '00', 'SDK=Python']);
  assert.ok(ranPython(bySdk) && !ranTypeScript(bySdk), bySdk.text);
  save(dir, 'Python\n');
  const byFile = make(dir, ['check', '00']);
  assert.equal(byFile.status, 0, byFile.text);
  assert.ok(ranPython(byFile) && !ranTypeScript(byFile), byFile.text);
});

test('n) an SDK that names no language says where it came from', () => {
  const dir = fixture();
  save(dir, 'py\n');
  const env = make(dir, ['check', '00'], { SDK: 'rust' });
  assert.equal(env.status, 2);
  assert.ok(env.lines.includes(`SDK in your environment is "rust", which isn't a language here: use ${sdkList}, or unset it.`), env.text);
  const cmd = make(dir, ['check', '00', 'SDK=rust']);
  assert.ok(cmd.lines.includes(`SDK on the command line is "rust", which isn't a language here: use ${sdkList}.`), cmd.text);
  const setup = make(dir, ['setup', 'SDK=rust']);
  assert.equal(setup.status, 2);
  assert.deepEqual(setup.stubs, [], 'a bad SDK stops setup before npm ci or any language installs');
  const blank = make(dir, ['check', '00'], { SDK: '' });
  assert.equal(blank.status, 0, 'an empty SDK counts as unset');
  assert.ok(ranPython(blank) && !ranTypeScript(blank));
});

test('o) make use with SDK set says SDK still overrides the saved language, by where SDK came from', () => {
  const dir = fixture();
  const env = make(dir, ['use', 'ts'], { SDK: 'py' });
  assert.equal(env.status, 0);
  assert.ok(env.lines.includes('SDK=py in your environment overrides your saved language. Unset SDK to use the saved one.'), env.text);
  const cmd = make(dir, ['use', 'ts', 'SDK=py']);
  assert.equal(cmd.status, 0);
  assert.ok(cmd.lines.includes("SDK=py applies only to the command it's on and leaves your saved language as it is."), cmd.text);
  const bad = make(dir, ['use', 'ts'], { SDK: 'rust' });
  assert.equal(bad.status, 0);
  assert.ok(bad.lines.includes(`SDK in your environment is "rust", which isn't a language here: use ${sdkList}, or unset it.`), bad.text);
  assert.ok(!bad.text.includes('overrides your saved language'), 'a bad SDK is named as bad, not as an override');
});

test('p) a failing check runs every chosen language, prints no hint and fails', () => {
  const r = make(fixture(), ['check', '00', 'SDK=all'], { STUB_EXIT: '1' });
  assert.notEqual(r.status, 0);
  assert.ok(ranPython(r) && ranTypeScript(r), r.text);
  assert.ok(!r.text.includes('passes its offline check'));
});

test('q) no tool at all: every command that needs a language says what to install', () => {
  const none = NONE;
  const dir = fixture([]);
  for (const args of [['check', '00'], ['check', '00', 'SDK=all']]) {
    const r = make(dir, args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.text}`);
    assert.ok(r.lines.includes(none), r.text);
  }
  // -k: past the harness and make tests, which this fixture can't run, to the language gate.
  for (const goal of ['ci', 'ci-solutions', 'ci-starts', 'unit']) {
    const r = make(dir, ['-k', goal]);
    assert.notEqual(r.status, 0, `${goal}: ${r.text}`);
    assert.ok(r.lines.includes(noneRepo(goal)), r.text);
    assert.ok(!r.text.includes('make use java'), `a repo gate ignores make use: ${r.text}`);
  }
  assert.ok(make(dir, ['-k', 'names-test', 'ci-solutions']).lines.includes(noneRepo('ci-solutions')));
  assert.ok(make(dir, ['-k', 'typecheck']).lines.includes(noneRepo('ci')));
  assert.deepEqual(make(dir, ['use']).lines, [none]);
});

test('r) make live names the file and runs the saved language\'s live check', () => {
  const dir = fixture();
  save(dir, 'ts\n');
  const r = make(dir, ['live', '00']);
  assert.equal(r.status, 0, r.text);
  assert.ok(r.lines.includes('Live check of your TypeScript file: typescript/missions/00-first-words/start.ts'), r.text);
  assert.deepEqual(r.stubs, ['STUB pnpm -s vitest run missions/00-first-words -t live']);
});

test('s) make run MIC=1 in a language without a microphone says where it runs', () => {
  const dir = fixture();
  save(dir, 'ts\n');
  const r = make(dir, ['run', '00', 'MIC=1']);
  assert.equal(r.status, 2);
  assert.ok(r.lines.includes('MIC=1 runs in Python: make run 00 SDK=py MIC=1 (add MISSION_TARGET=solution to use the reference answer)'), r.text);
  assert.deepEqual(r.stubs, []);
});

test('docker a) make help has the Docker line; with WORKSHOP_IN_DOCKER (compose.yaml) MIC=1 stops before anything installs', () => {
  const dir = fixture();
  save(dir, 'py\n');
  const DOCKER = { WORKSHOP_IN_DOCKER: '1' };
  const help = make(dir, ['help'], DOCKER);
  assert.equal(help.status, 0, help.text);
  assert.ok(help.lines.includes('In Docker, put "docker compose run --rm workshop" in front of each command (workshop-java for Java).'), help.text);
  const mic = make(dir, ['run', '00', 'MIC=1'], DOCKER);
  assert.equal(mic.status, 2, mic.text);
  assert.equal(mic.lines[0], 'No microphone in a container. Type your turns: make run 00 (Docker: docker compose run --rm workshop make run 00)');
  assert.deepEqual(mic.stubs, [], 'the mic extra never installs');
  // In the workshop-java service (WORKSHOP_DOCKER_SERVICE) the printed form names that service.
  const micJava = make(dir, ['run', '00', 'MIC=1'], { ...DOCKER, WORKSHOP_DOCKER_SERVICE: 'workshop-java' });
  assert.equal(micJava.status, 2, micJava.text);
  assert.equal(micJava.lines[0], 'No microphone in a container. Type your turns: make run 00 (Docker: docker compose run --rm workshop-java make run 00)');
  // Outside Docker MIC=1 runs Python with the extra, as before.
  const run = make(dir, ['run', '00', 'MIC=1']);
  assert.ok(run.stubs.includes('STUB uv run --extra mic python missions/00-first-words/start.py --mic'), run.text);
  // The help text is every comment line of the header, to its first blank line.
  const plain = make(dir, ['help']);
  const trimmed = plain.lines.map((l) => l.trim());
  assert.equal(trimmed[0], 'make setup              install the check harness and the languages you have tools for (SDK=py, SDK=ts or SDK=java: that one language); creates .env');
  assert.ok(trimmed.includes('make run 00             talk to your mission 00 agent: type lines, Ctrl-D (or Ctrl-C) hangs up. Needs DEEPGRAM_API_KEY or a workshop token in .env (MIC=1 for your mic, Python)'), plain.text);
  assert.ok(trimmed.includes('MISSION_TARGET=solution checks the reference answer instead of your start file.'), plain.text);
  assert.equal(trimmed.length, 11, 'the ten help lines, then the missions line');
  assert.ok(plain.lines.at(-1).startsWith('Missions with checks: '), plain.text);
});

test('docker b) every Python check and run starts with the syntax step, told which command to name', () => {
  const dir = fixture();
  save(dir, 'py\n');
  const check = make(dir, ['check', '00']);
  assert.deepEqual(check.stubs.slice(0, 2), [
    'STUB uv run python -m agent.syntax missions/00-first-words/start.py make check 00',
    'STUB uv run pytest -q missions/00-first-words',
  ]);
  const run = make(dir, ['run', '00']);
  assert.equal(run.stubs[0], 'STUB uv run python -m agent.syntax missions/00-first-words/start.py make run 00');
  // WORKSHOP_AGAIN reaches pytest (CHECK_py and LIVE_py), in the same form the syntax step was told.
  assert.ok(check.lines.includes('ENV uv WORKSHOP_AGAIN=make check 00'), check.text);
  assert.ok(make(dir, ['live', '00']).lines.includes('ENV uv WORKSHOP_AGAIN=make live 00'));
  assert.ok(make(dir, ['check', '00'], { WORKSHOP_IN_DOCKER: '1' }).lines.includes('ENV uv WORKSHOP_AGAIN=docker compose run --rm workshop make check 00'));
  // SDK= rides along in the run-again command only when it mattered (another language than the saved one).
  save(dir, 'ts\n');
  const other = make(dir, ['check', '00', 'SDK=py']);
  assert.equal(other.stubs[0], 'STUB uv run python -m agent.syntax missions/00-first-words/start.py make check 00 SDK=py');
  // In Docker (compose.yaml sets WORKSHOP_IN_DOCKER) the run-again command carries the docker compose
  // prefix every other printed command has, with the service WORKSHOP_DOCKER_SERVICE names.
  assert.equal(make(dir, ['check', '00', 'SDK=py'], { WORKSHOP_IN_DOCKER: '1' }).stubs[0], 'STUB uv run python -m agent.syntax missions/00-first-words/start.py docker compose run --rm workshop make check 00 SDK=py');
  assert.equal(make(dir, ['check', '00', 'SDK=py'], { WORKSHOP_IN_DOCKER: '1', WORKSHOP_DOCKER_SERVICE: 'workshop-java' }).stubs[0], 'STUB uv run python -m agent.syntax missions/00-first-words/start.py docker compose run --rm workshop-java make check 00 SDK=py');
  // A file that doesn't parse stops the check before pytest.
  const bad = make(dir, ['check', '00', 'SDK=py'], { STUB_EXIT_uv: '1' });
  assert.equal(bad.status, 2, bad.text); // make exits 2 when a recipe fails
  assert.deepEqual(bad.stubs, ['STUB uv run python -m agent.syntax missions/00-first-words/start.py make check 00 SDK=py'], `pytest never ran: ${bad.text}`);
});

test('docker c) a tsc error gets the type or syntax framing line, with the run-again command in its Docker form', () => {
  const dir = fixture();
  save(dir, 'ts\n');
  const TYPE = "Your file has a TypeScript type error (line and column below). Fix the value's type; a cast is not the fix, unless the mission's brief shows one.";
  const type = make(dir, ['check', '00'], { STUB_OUT_pnpm: 'missions/00-first-words/start.ts(24,10): error TS2352: x' });
  assert.equal(type.status, 2, type.text); // the check's status is 1, so make exits 2
  assert.ok(type.lines.includes('FAIL  TypeScript (tsc) found type errors in typescript/missions/00-first-words/start.ts:'), type.text);
  assert.ok(type.lines.includes(TYPE), type.text);
  assert.ok(type.lines.includes('missions/00-first-words/start.ts(24,10): error TS2352: x'), 'tsc\'s own line follows');
  // A five-digit code is a type error too (TS18046), not a syntax one.
  assert.ok(make(dir, ['check', '00'], { STUB_OUT_pnpm: "missions/00-first-words/start.ts(86,47): error TS18046: 'event.functions' is of type 'unknown'." }).lines.includes(TYPE));
  // A four-digit TS1xxx code is a syntax error: the line names the command to run again.
  const parse = make(dir, ['check', '00'], { STUB_OUT_pnpm: "missions/00-first-words/start.ts(16,31): error TS1002: Unterminated string literal." });
  assert.ok(parse.lines.includes('Your file has a TypeScript syntax error (line and column below). Fix it, then run make check 00 again.'), parse.text);
  assert.ok(!parse.lines.includes(TYPE));
  // In Docker that command carries the compose prefix, on the service compose.yaml names.
  const docker = make(dir, ['check', '00'], { STUB_OUT_pnpm: "missions/00-first-words/start.ts(16,31): error TS1002: x", WORKSHOP_IN_DOCKER: '1' });
  assert.ok(docker.lines.includes('Your file has a TypeScript syntax error (line and column below). Fix it, then run docker compose run --rm workshop make check 00 again.'), docker.text);
  // Another file's lines are not this file's: no framing line, PASS.
  const other = make(dir, ['check', '00'], { STUB_OUT_pnpm: 'src/common.ts(1,1): error TS2322: x' });
  assert.ok(other.lines.includes('PASS  TypeScript (tsc): typescript/missions/00-first-words/start.ts typechecks'), other.text);
  // A syntax error in another file: tsc checks nothing, so no PASS; one line per broken file,
  // naming it and, for a mission's start file, the make check that shows the line.
  const OTHER = 'has a syntax error, and tsc checks no file while any file has one. Fix that file first';
  const broken = make(dir, ['check', '00'], { STUB_OUT_pnpm: 'missions/04-polyglot/start.ts(120,1): error TS1128: Declaration or statement expected.' });
  assert.equal(broken.status, 2, broken.text);
  assert.ok(broken.lines.includes(`FAIL  TypeScript (tsc): typescript/missions/04-polyglot/start.ts ${OTHER} (make check 04 names the line), then run make check 00 again.`), broken.text);
  assert.ok(!broken.text.includes('PASS  TypeScript (tsc)') && !broken.lines.includes(TYPE), broken.text);
  // A helper or example file: no make check names its line.
  assert.ok(make(dir, ['check', '00'], { STUB_OUT_pnpm: 'src/common.ts(1,1): error TS1005: x' }).lines.includes(`FAIL  TypeScript (tsc): typescript/src/common.ts ${OTHER}, then run make check 00 again.`));
  // In Docker both commands carry the compose prefix.
  const brokenDocker = make(dir, ['check', '00'], { STUB_OUT_pnpm: 'missions/04-polyglot/start.ts(120,1): error TS1128: x', WORKSHOP_IN_DOCKER: '1' });
  assert.ok(brokenDocker.lines.includes(`FAIL  TypeScript (tsc): typescript/missions/04-polyglot/start.ts ${OTHER} (docker compose run --rm workshop make check 04 names the line), then run docker compose run --rm workshop make check 00 again.`), brokenDocker.text);
  // Your own file broken too: your syntax line, not the other file's.
  const both = make(dir, ['check', '00'], { STUB_OUT_pnpm: 'missions/00-first-words/start.ts(16,31): error TS1002: x\nmissions/04-polyglot/start.ts(120,1): error TS1128: x' });
  assert.ok(both.lines.includes('Your file has a TypeScript syntax error (line and column below). Fix it, then run make check 00 again.'), both.text);
  assert.ok(!both.text.includes(OTHER), both.text);
  // SDK= on the command line: the hint carries it too, as the run-again command does.
  save(dir, 'py\n');
  assert.ok(make(dir, ['check', '00', 'SDK=ts'], { STUB_OUT_pnpm: 'missions/04-polyglot/start.ts(120,1): error TS1128: x' }).lines.includes(`FAIL  TypeScript (tsc): typescript/missions/04-polyglot/start.ts ${OTHER} (make check 04 SDK=ts names the line), then run make check 00 SDK=ts again.`));
});

test('t) make use <a target name> stops on make use\'s line, with no warning about overriding that target', () => {
  const dir = fixture();
  for (const word of ['setup', 'help']) {
    const r = make(dir, ['use', word]);
    assert.equal(r.status, 2);
    assert.ok(r.lines.includes(`make use takes ${orList(LISTED)} (you typed ${word}).`), r.text);
    assert.doesNotMatch(r.text, /overriding|ignoring old/);
    assert.deepEqual(r.stubs, []);
  }
});

test('u) a failing install fails make setup, after the other languages install', () => {
  const r = make(fixture(), ['setup'], { STUB_EXIT_uv: '1' });
  assert.notEqual(r.status, 0, r.text);
  assert.ok(r.stubs.includes('STUB uv sync'), r.text);
  assert.ok(r.stubs.includes('STUB pnpm install --frozen-lockfile'), 'TypeScript still installs');
  assert.ok(r.lines.includes('Setup failed for Python (see the output above). Fix it, then run make setup again.'), r.text);
  assert.match(r.text, /setup-py\] Error 1/, 'make names the step that failed');
  const both = make(fixture(), ['setup'], { STUB_EXIT_uv: '1', STUB_EXIT_pnpm: '1' });
  assert.notEqual(both.status, 0);
  assert.ok(both.lines.includes('Setup failed for Python and TypeScript (see the output above). Fix it, then run make setup again.'), both.text);
  const skipped = make(fixture(['pnpm']), ['setup']);
  assert.equal(skipped.status, 0, 'a missing tool is skipped, not a failure');
});

test('v) native Windows (OS=Windows_NT): every goal prints the Windows line and stops; ALLOW_WINDOWS=1 runs as usual', () => {
  const windows = mvar('MSG_WINDOWS');
  const dir = fixture();
  for (const args of [[], ['help'], ['use', 'py'], ['check', '00'], ['setup'], ['run', '00', 'MIC=1'], ['ci']]) {
    const r = make(dir, args, { OS: 'Windows_NT' });
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.text}`);
    assert.equal(r.lines[0], windows, r.text);
    assert.deepEqual(r.stubs, [], `${args.join(' ')} runs nothing`);
  }
  assert.equal(existsSync(join(dir, '.workshop-lang')), false);
  assert.equal(existsSync(join(dir, '.env')), false);

  const use = make(dir, ['use', 'py'], { OS: 'Windows_NT', ALLOW_WINDOWS: '1' });
  assert.equal(use.status, 0, use.text);
  assert.equal(saved(dir), 'py\n');
  const check = make(dir, ['check', '00'], { OS: 'Windows_NT', ALLOW_WINDOWS: '1' });
  assert.equal(check.status, 0, check.text);
  assert.ok(ranPython(check) && !ranTypeScript(check), check.text);
});

test('w) setup stops with one line on a Node.js outside ^20.19.0 || >=22.12.0, before npm ci', () => {
  // bin/node becomes the real node with process.versions faked to FAKE_NODE, and `node -v`
  // prints it.
  const dir = fixture();
  writeFileSync(join(dir, 'fake-node.cjs'), "Object.defineProperty(process, 'versions', { value: { ...process.versions, node: process.env.FAKE_NODE } });\n");
  unlinkSync(join(dir, 'bin/node'));
  writeFileSync(join(dir, 'bin/node'), `#!/bin/sh\nif [ "$1" = -v ]; then echo "v$FAKE_NODE"; exit 0; fi\nexec "${process.execPath}" -r "${join(dir, 'fake-node.cjs')}" "$@"\n`);
  chmodSync(join(dir, 'bin/node'), 0o755);
  for (const v of ['18.19.1', '20.18.3', '21.7.3', '22.11.0']) {
    const r = make(dir, ['setup'], { FAKE_NODE: v });
    assert.equal(r.status, 2, `${v}: ${r.text}`);
    assert.ok(r.lines.includes(nodeTooOld(`v${v}`)), r.text);
    assert.deepEqual(r.stubs, [], `${v}: nothing installs`);
  }
  for (const v of ['20.19.0', '22.12.0', '24.1.0']) {
    const r = make(dir, ['setup-harness'], { FAKE_NODE: v });
    assert.equal(r.status, 0, `${v}: ${r.text}`);
    assert.deepEqual(r.stubs, ['STUB npm ci --no-audit --no-fund'], r.text);
  }
});

test('x) a language without a mission yet (MISSIONS_<id>) says so; the others still run, and the CI loops skip it', () => {
  const dir = fixture();
  const one = make(dir, ['check', '00', 'SDK=ts', 'MISSIONS_ts=']);
  assert.equal(one.status, 2, one.text);
  assert.ok(one.lines.includes("Mission 00 runs in Python for now: make check 00 SDK=py"), one.text);
  assert.deepEqual(one.stubs, []);

  const both = make(dir, ['check', '00', 'SDK=py ts', 'MISSIONS_ts=']);
  assert.equal(both.status, 2, both.text);
  assert.ok(ranPython(both) && !ranTypeScript(both), both.text);
  assert.ok(both.lines.includes("Mission 00 runs in Python for now: make check 00 SDK=py"), both.text);
  assert.ok(!both.text.includes('passes its offline check'), both.text);

  const failing = make(dir, ['check', '00', 'SDK=py ts', 'MISSIONS_ts='], { STUB_EXIT: '1' });
  assert.match(failing.text, /check\] Error 1/, 'a failed check (1) wins over a mission not there yet (2)');

  const run = make(dir, ['run', '00', 'SDK=ts', 'MISSIONS_ts=']);
  assert.equal(run.status, 2, run.text);
  assert.ok(run.lines.includes("Mission 00 runs in Python for now: make run 00 SDK=py"), run.text);

  const solutions = make(dir, ['ci-solutions', 'MISSIONS_ts=']);
  assert.equal(solutions.status, 0, solutions.text);
  assert.ok(ranPython(solutions) && !ranTypeScript(solutions), solutions.text);
  assert.ok(!solutions.text.includes('runs in Python for now'), `skipped without a line: ${solutions.text}`);
  // ci-starts keeps each check's output to itself and prints one line per mission and language.
  const starts = make(dir, ['ci-starts', 'MISSIONS_ts=']);
  assert.ok(starts.text.includes('missions/00-first-words (py)'), starts.text);
  assert.ok(!starts.text.includes('(ts)'), starts.text);
});

test('z) make check 00 SDK=ts before make setup SDK=ts stops with the setup line', () => {
  const dir = fixture();
  save(dir, 'py\n');
  unlinkSync(join(dir, 'typescript/node_modules/.bin/vitest'));
  const r = make(dir, ['check', '00', 'SDK=ts']);
  assert.equal(r.status, 2, r.text);
  assert.equal(r.lines[0], "TypeScript isn't set up in this folder yet (make setup never installed it). Run make setup SDK=ts once, then this command again.");
  assert.deepEqual(r.stubs, [], 'nothing runs');
  // The same for run and live, and in Docker the line gives the compose form (on the service compose.yaml names).
  assert.equal(make(dir, ['run', '00', 'SDK=ts']).lines[0], r.lines[0]);
  assert.equal(make(dir, ['live', '00', 'SDK=ts']).lines[0], r.lines[0]);
  const docker = make(dir, ['check', '00', 'SDK=ts'], { WORKSHOP_IN_DOCKER: '1' });
  assert.equal(docker.lines[0], "TypeScript isn't set up in this folder yet (make setup never installed it). Run docker compose run --rm workshop make setup SDK=ts once, then this command again.");
  const java = make(dir, ['check', '00', 'SDK=ts'], { WORKSHOP_IN_DOCKER: '1', WORKSHOP_DOCKER_SERVICE: 'workshop-java' });
  assert.equal(java.lines[0], "TypeScript isn't set up in this folder yet (make setup never installed it). Run docker compose run --rm workshop-java make setup SDK=ts once, then this command again.");
  // make setup SDK=ts and make use ts still run (neither goes through need-sdk); after setup the check runs.
  const setup = make(dir, ['setup', 'SDK=ts', 'USE_HINT=0']);
  assert.equal(setup.status, 0, setup.text);
  assert.ok(setup.stubs.includes('STUB pnpm install --frozen-lockfile'), setup.text);
  writeFileSync(join(dir, 'typescript/node_modules/.bin/vitest'), '');
  chmodSync(join(dir, 'typescript/node_modules/.bin/vitest'), 0o755);
  const after = make(dir, ['check', '00', 'SDK=ts']);
  assert.ok(after.stubs.some((l) => l.startsWith('STUB pnpm -s vitest run missions/00-first-words')), after.text);
  // Python installs on demand (uv syncs at every run), so a one-off SDK=py never stops here.
  save(dir, 'ts\n');
  assert.ok(ranPython(make(dir, ['check', '00', 'SDK=py'])));
});

test('harness) make check before the harness is installed (a fresh clone, or the empty mount point an emptied Docker volume leaves) stops with the harness line', () => {
  const dir = fixture();
  save(dir, 'py\n');
  rmSync(join(dir, 'tools/replay-server/node_modules'), { recursive: true });
  const r = make(dir, ['check', '00']);
  assert.equal(r.status, 2, r.text);
  assert.equal(r.lines[0], "The check harness isn't installed. Run make setup once, then this command again.");
  assert.deepEqual(r.stubs, [], 'nothing runs');
  assert.equal(make(dir, ['run', '00']).lines[0], r.lines[0]);
  assert.equal(make(dir, ['live', '00']).lines[0], r.lines[0]);
  // An empty node_modules (compose's mount point after down -v) is not an install.
  mkdirSync(join(dir, 'tools/replay-server/node_modules'), { recursive: true });
  assert.equal(make(dir, ['check', '00']).lines[0], r.lines[0]);
  // In Docker the line gives the compose form, on the service compose.yaml names.
  const docker = make(dir, ['check', '00'], { WORKSHOP_IN_DOCKER: '1' });
  assert.equal(docker.lines[0], "The check harness isn't installed. Run docker compose run --rm workshop make setup once, then this command again.");
  const java = make(dir, ['check', '00'], { WORKSHOP_IN_DOCKER: '1', WORKSHOP_DOCKER_SERVICE: 'workshop-java' });
  assert.equal(java.lines[0], "The check harness isn't installed. Run docker compose run --rm workshop-java make setup once, then this command again.");
  // A missing tool still prints first (the probe sits after the tool loop).
  const noPnpm = fixture(['uv']);
  save(noPnpm, 'ts\n');
  rmSync(join(noPnpm, 'tools/replay-server/node_modules'), { recursive: true });
  assert.equal(make(noPnpm, ['check', '00']).lines[0], NEEDS_PNPM);
  // make setup still runs, and installs the harness first.
  const setup = make(dir, ['setup', 'USE_HINT=0']);
  assert.equal(setup.status, 0, setup.text);
  assert.ok(setup.stubs.includes('STUB npm ci --no-audit --no-fund'), setup.text);
});

test('y) a failing copy of .env.example fails make setup', () => {
  const dir = fixture();
  unlinkSync(join(dir, '.env.example'));
  const r = make(dir, ['setup', 'USE_HINT=0']);
  assert.notEqual(r.status, 0, r.text);
  assert.equal(existsSync(join(dir, '.env')), false);
  assert.ok(!r.text.includes('Created .env'), r.text);
  assert.ok(r.lines.includes("Couldn't copy .env.example to .env. Restore it with git checkout .env.example, then run make setup again."), r.text);
});

const ENV_CREATED = 'Created .env: at the workshop, paste the two WORKSHOP_ lines from the /code page into it; at home, put your DEEPGRAM_API_KEY in it';

test('y2) a first make setup creates .env and its line names the token path before the key, verbatim', () => {
  const dir = fixture();
  const first = make(dir, ['setup', 'USE_HINT=0']);
  assert.equal(first.status, 0, first.text);
  assert.ok(existsSync(join(dir, '.env')));
  assert.ok(first.lines.includes(ENV_CREATED), first.text);
  const again = make(dir, ['setup', 'USE_HINT=0']);
  assert.ok(!again.text.includes('Created .env'), 'the line prints on the copy only');
});

// --- Java: opt-in, missions 00 only in this fixture ---

/**
 * fixture() plus a Java side: java/mission.sh prints `STUB mission.sh <args>`, mission 00 has
 * a Java start file and mission 02 has checks but no Java yet. With `java` in `stubs`, a
 * `java` that logs every call to calls.log, so a test can tell it was never probed.
 */
function javaFixture(stubs = ['uv', 'pnpm', 'java']) {
  const dir = fixture(stubs.filter((t) => t !== 'java'));
  mkdirSync(join(dir, 'missions/02-read-the-room'), { recursive: true });
  writeFileSync(join(dir, 'missions/02-read-the-room/check.mjs'), '');
  mkdirSync(join(dir, 'java/missions/m00_first_words'), { recursive: true });
  for (const f of ['Start.java', 'Solution.java']) writeFileSync(join(dir, 'java/missions/m00_first_words', f), '');
  writeFileSync(join(dir, 'java/mission.sh'), 'echo "STUB mission.sh $*"\nexit ${STUB_EXIT_java:-${STUB_EXIT:-0}}\n');
  if (stubs.includes('java')) {
    writeFileSync(join(dir, 'bin/java'), `#!/bin/sh\necho "java $*" >> "${join(dir, 'calls.log')}"\necho 'openjdk version "21.0.4"' >&2\n`);
    chmodSync(join(dir, 'bin/java'), 0o755);
  }
  return dir;
}
const javaCalls = (dir) => (existsSync(join(dir, 'calls.log')) ? readFileSync(join(dir, 'calls.log'), 'utf8') : '');
const ranJava = (r) => r.stubs.some((l) => l.startsWith('STUB mission.sh '));
const NEEDS_JDK = "Java needs a JDK 17 or newer (https://adoptium.net), which isn't installed. Install it, then run make setup.";

test('java a) nothing picked: the pick line offers Java, and nothing probes or runs it', () => {
  assert.ok(LISTED.includes('java') && !AUTO_LANGS.includes('java'), 'Java is listed, never auto');
  const dir = javaFixture();
  const r = make(dir, ['check', '00']);
  assert.equal(r.status, 2);
  assert.ok(r.lines.includes(PICK), r.text);
  assert.ok(PICK.includes('make use java (Java)'), PICK);
  assert.deepEqual(r.stubs, []);
  const use = make(dir, ['use']);
  assert.deepEqual(use.lines, [PICK]);
  const bad = make(dir, ['use', 'rust']);
  assert.ok(bad.lines.includes(`make use takes ${orList(LISTED)} (you typed rust).`), bad.text);
  const setup = make(dir, ['setup']);
  assert.equal(setup.status, 0, setup.text);
  assert.ok(!setup.stubs.includes('STUB mission.sh setup'), setup.text);
  assert.equal(setup.lines.at(-1), PICK, setup.text);
  assert.equal(javaCalls(dir), '', 'java was never run, not even java -version');
});

// The exact words, so a change to say_list and orList together can't slip by.
test('java a2) with py, ts and java listed, each line that lists languages reads exactly so', () => {
  assert.deepEqual(LISTED, ['py', 'ts', 'java']);
  const pick = 'make use py (Python), make use ts (TypeScript) or make use java (Java)';
  const dir = javaFixture();
  assert.deepEqual(make(dir, ['use']).lines, [`Pick your language first: ${pick}`]);
  assert.ok(make(dir, ['use', 'rust']).lines.includes('make use takes py, ts or java (you typed rust).'));
  assert.ok(make(dir, ['use'], { SDK: 'rust' }).lines.includes(
    'SDK in your environment is "rust", which isn\'t a language here: use SDK=py, SDK=ts or SDK=java, or unset it.'));
  assert.ok(make(dir, ['check', '00', 'SDK=rust']).lines.includes(
    'SDK on the command line is "rust", which isn\'t a language here: use SDK=py, SDK=ts or SDK=java.'));
  save(dir, 'rust\n');
  assert.ok(make(dir, ['check', '00']).lines.includes(
    `.workshop-lang says "rust", which isn't a language here. Pick again: ${pick}`));
  save(dir, 'py\n');
  assert.deepEqual(make(dir, ['use']).lines,
    ['Your language: Python (saved in .workshop-lang). To switch: make use ts or make use java']);
  assert.equal(javaCalls(dir), '', 'none of these lines probes Java');
  save(dir, 'java\n');
  assert.deepEqual(make(dir, ['use']).lines,
    ['Your language: Java (saved in .workshop-lang). To switch: make use py or make use ts']);
  assert.deepEqual(make(javaFixture([]), ['use']).lines, [
    'To run a mission, install uv (Python, https://docs.astral.sh/uv/) or pnpm (TypeScript, npm install -g pnpm@10), '
      + 'then run make setup. For Java: with a JDK 17 or newer (https://adoptium.net), '
      + 'run make use java, then make setup.',
  ]);
});

test('java b) make use java saves it; check 00 runs only mission.sh on the Java start file', () => {
  const dir = javaFixture();
  const use = make(dir, ['use', 'java']);
  assert.equal(use.status, 0, use.text);
  assert.equal(saved(dir), 'java\n');
  assert.ok(use.lines.includes('Saved: Java. make check, run and live use it now. Add SDK=py to run one command in Python.'), use.text);

  const r = make(dir, ['check', '00']);
  assert.equal(r.status, 0, r.text);
  assert.deepEqual(r.stubs, ['STUB mission.sh check 00-first-words']);
  assert.ok(r.lines.includes('Checking your Java file: java/missions/m00_first_words/Start.java'), r.text);
  assert.ok(r.lines.includes('Mission 00 passes its offline check: java/missions/m00_first_words/Start.java'), r.text);
  assert.ok(r.lines.some((l) => l.startsWith('Next: make run 00 to talk')), r.text);

  const sol = make(dir, ['check', '00', 'MISSION_TARGET=solution']);
  assert.ok(sol.lines.includes('Checking the Java reference answer: java/missions/m00_first_words/Solution.java'), sol.text);

  const run = make(dir, ['run', '00']);
  assert.equal(run.status, 0, run.text);
  assert.ok(run.lines.includes('Running your Java file: java/missions/m00_first_words/Start.java'), run.text);
  assert.deepEqual(run.stubs, ['STUB mission.sh run 00-first-words']);
  const live = make(dir, ['live', '00']);
  assert.deepEqual(live.stubs, ['STUB mission.sh live 00-first-words']);

  const mic = make(dir, ['run', '00', 'MIC=1']);
  assert.equal(mic.status, 2);
  assert.ok(mic.lines.includes('MIC=1 runs in Python: make run 00 SDK=py MIC=1 (add MISSION_TARGET=solution to use the reference answer)'), mic.text);

  const status = make(dir, ['use']);
  assert.deepEqual(status.lines, [`Your language: Java (saved in .workshop-lang). To switch: ${switchFrom('java')}`]);
  // The name the lines show works too, and the file gets the short id.
  make(dir, ['use', 'py']);
  assert.equal(saved(dir), 'py\n');
  make(dir, ['use', 'Java']);
  assert.equal(saved(dir), 'java\n');
});

test('java c) a mission not in Java yet stops with one line; another language still runs it', () => {
  const dir = javaFixture();
  save(dir, 'java\n');
  const r = make(dir, ['check', '02']);
  assert.equal(r.status, 2, r.text);
  assert.ok(r.lines.includes("Mission 02 runs in Python or TypeScript for now: make check 02 SDK=py"), r.text);
  assert.deepEqual(r.stubs, []);
  const run = make(dir, ['run', '02']);
  assert.equal(run.status, 2, run.text);
  assert.ok(run.lines.includes("Mission 02 runs in Python or TypeScript for now: make run 02 SDK=py"), run.text);
  const both = make(dir, ['check', '02', 'SDK=py java']);
  assert.ok(ranPython(both) && !ranJava(both), both.text);
  assert.ok(both.lines.includes("Mission 02 runs in Python or TypeScript for now: make check 02 SDK=py"), both.text);
});

test('java d) the CI loops run Java on its missions only', () => {
  const dir = javaFixture();
  const sol = make(dir, ['ci-solutions', 'SDK=java']);
  assert.equal(sol.status, 0, sol.text);
  assert.deepEqual(sol.stubs, ['STUB mission.sh check 00-first-words']);
  assert.ok(!sol.text.includes('for now:'), sol.text);
  const starts = make(dir, ['ci-starts', 'SDK=java'], { STUB_EXIT: '1' });
  assert.ok(starts.text.includes('missions/00-first-words (java)'), starts.text);
  assert.ok(!starts.text.includes('02-read-the-room (java)'), starts.text);
  const mixed = make(dir, ['ci-solutions', 'SDK=py java']);
  assert.equal(mixed.status, 0, mixed.text);
  assert.ok(mixed.stubs.includes('STUB mission.sh check 00-first-words'), mixed.text);
  // Each Python check is the syntax step, then pytest.
  assert.equal(mixed.stubs.filter((l) => l.startsWith('STUB uv run pytest ')).length, 2, 'Python checks 00 and 02');
  assert.equal(mixed.stubs.filter((l) => l.startsWith('STUB uv run python -m agent.syntax ')).length, 2, 'the syntax step runs before each');
});

test('java e) without SDK=java, the repo gates and SDK=all never run or probe Java', () => {
  const dir = javaFixture();
  save(dir, 'java\n');
  for (const args of [['ci-solutions'], ['ci-starts'], ['unit'], ['typecheck'], ['check', '00', 'SDK=all']]) {
    const r = make(dir, args);
    assert.ok(!ranJava(r), `${args.join(' ')}: ${r.text}`);
  }
  assert.equal(javaCalls(dir), '', 'java was never run, not even java -version');
});

test('java f) a saved java widens make setup to Java; SDK=py keeps it out', () => {
  const dir = javaFixture();
  const before = make(dir, ['setup', 'USE_HINT=0']);
  assert.ok(!before.stubs.includes('STUB mission.sh setup'), 'nothing saved: no Java');
  save(dir, 'java\n');
  const r = make(dir, ['setup']);
  assert.equal(r.status, 0, r.text);
  assert.ok(r.stubs.includes('STUB uv sync') && r.stubs.includes('STUB pnpm install --frozen-lockfile'), 'setup only widens');
  assert.ok(r.stubs.includes('STUB mission.sh setup'), r.text);
  assert.equal(r.lines.at(-1), `Your language: Java (saved in .workshop-lang). To switch: ${switchFrom('java')}`);
  const one = make(dir, ['setup', 'SDK=py']);
  assert.ok(!one.stubs.includes('STUB mission.sh setup'), one.text);
  const failing = make(dir, ['setup'], { STUB_EXIT_uv: '1', STUB_EXIT_pnpm: '1', STUB_EXIT_java: '1' });
  assert.ok(failing.text.includes('Setup failed for Python and TypeScript and Java'), failing.text);
});

test('java g) no JDK: make use java saves it with the install line; check stops on it; setup skips Java', () => {
  const dir = javaFixture(['uv', 'pnpm']);
  const use = make(dir, ['use', 'java']);
  assert.equal(use.status, 0);
  assert.equal(saved(dir), 'java\n');
  assert.ok(use.lines.includes(NEEDS_JDK), use.text);
  const r = make(dir, ['check', '00']);
  assert.equal(r.status, 2);
  assert.ok(r.lines.includes(NEEDS_JDK), r.text);
  assert.deepEqual(r.stubs, []);
  // Java is the saved language, so a setup that skipped it ends on that, exit 2, after .env.
  const setup = make(dir, ['setup', 'USE_HINT=0']);
  assert.equal(setup.status, 2, setup.text);
  assert.ok(setup.lines.includes('Skipping Java: it needs a JDK 17 or newer (https://adoptium.net).'), setup.text);
  assert.equal(setup.lines.at(-2), NEEDS_JDK, 'the needs line is the last thing before make\'s own Error 2');
  assert.ok(existsSync(join(dir, '.env')), '.env is created before the stop');
});

const DOCKER_LINE = 'The Docker image has no JDK. For Java in Docker, use the workshop-java service (docker compose run --rm workshop-java make use java, then make setup); or VS Code Dev Containers, GitHub Codespaces, or your own machine (README: Java).';

// Once .workshop-lang says java, the line is this same command on the workshop-java service.
const SAVED_LINE = (cmd) => `The Docker image has no JDK, and Java is your language: run this same command with workshop-java in place of workshop (docker compose run --rm workshop-java make ${cmd}); or VS Code Dev Containers, GitHub Codespaces, or your own machine (README: Java).`;

test('java docker) in the plain compose container (WORKSHOP_IN_DOCKER), every Java line says the image has no JDK and names workshop-java', () => {
  const env = { WORKSHOP_IN_DOCKER: '1' };
  const dir = javaFixture(['uv', 'pnpm']);
  const use = make(dir, ['use', 'java'], env);
  assert.equal(use.status, 0, use.text);
  assert.equal(saved(dir), 'java\n');
  assert.deepEqual(use.lines.slice(-1), [DOCKER_LINE]); // no language was saved when this make started
  const useAgain = make(dir, ['use', 'java'], env);
  assert.equal(useAgain.status, 0, useAgain.text);
  assert.deepEqual(useAgain.lines.slice(-1), [SAVED_LINE('use java')]); // now the file says java
  for (const goal of ['check', 'run', 'live']) {
    const r = make(dir, [goal, '00'], env);
    assert.equal(r.status, 2, r.text);
    assert.equal(r.lines[0], SAVED_LINE(`${goal} 00`), r.text);
    assert.deepEqual(r.stubs, []);
  }
  const setup = make(dir, ['setup', 'USE_HINT=0'], env);
  assert.equal(setup.status, 2, setup.text);
  assert.ok(setup.lines.includes(`Skipping Java: ${SAVED_LINE('setup')}`), setup.text);
  assert.equal(setup.lines.at(-2), SAVED_LINE('setup'));
  assert.ok(existsSync(join(dir, '.env')), '.env is still created before the stop');
  // With another language saved, SDK=java on the command line keeps the generic line.
  make(dir, ['use', 'py'], env);
  const sdk = make(dir, ['check', '00', 'SDK=java'], env);
  assert.equal(sdk.status, 2, sdk.text);
  assert.equal(sdk.lines[0], DOCKER_LINE, sdk.text);
  assert.ok(!`${use.text}${useAgain.text}${setup.text}${sdk.text}`.includes('adoptium'), 'no download link in the container');
  // Python and TypeScript read as always there; the pick line after a fresh setup too.
  const py = make(javaFixture(['uv', 'pnpm']), ['setup', 'USE_HINT=0'], env);
  assert.equal(py.status, 0, py.text);
  assert.ok(!py.text.includes('Skipping Java'), 'Java is never probed unless picked');
  const check = make(dir, ['check', '00'], env);
  assert.equal(check.status, 0, check.text);
});

test('java docker2) with a javac in the workshop-java container, Java runs as on a host and the hints name that service', () => {
  const env = { WORKSHOP_IN_DOCKER: '1', WORKSHOP_DOCKER_SERVICE: 'workshop-java' };
  const dir = javaFixture(['uv', 'pnpm', 'java']);
  const use = make(dir, ['use', 'java'], env);
  assert.equal(use.status, 0, use.text);
  assert.equal(use.lines.at(-1), 'Saved: Java. make check, run and live use it now. Add SDK=py to run one command in Python.');
  assert.ok(!use.text.includes(DOCKER_LINE) && !use.text.includes('adoptium'), use.text);
  const check = make(dir, ['check', '00'], env);
  assert.equal(check.status, 0, check.text);
  assert.ok(ranJava(check), check.text);
  assert.ok(!check.text.includes('The Docker image has no JDK'), check.text);
  assert.ok(check.lines.some((l) => l.startsWith('Next: docker compose run --rm workshop-java make run 00 to talk')), check.text);
  const setup = make(dir, ['setup', 'USE_HINT=0'], env);
  assert.equal(setup.status, 0, setup.text);
  assert.ok(setup.stubs.includes('STUB mission.sh setup') && !setup.text.includes('Skipping Java'), setup.text);
});

test('compose) compose.yaml has the workshop-java service built from the Dockerfile\'s JDK arg', () => {
  const compose = readFileSync(join(ROOT, 'compose.yaml'), 'utf8');
  const dockerfile = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');
  assert.match(compose, /^\s+workshop-java:/m);
  assert.match(compose, /JDK: "17"/);
  assert.match(compose, /WORKSHOP_DOCKER_SERVICE: workshop-java/);
  assert.match(compose, /WORKSHOP_DOCKER_SERVICE: workshop$/m, 'the plain service names itself too');
  assert.match(dockerfile, /^ARG JDK=$/m);
  assert.match(dockerfile, /openjdk-\$JDK-jdk-headless/);
});

test('java h) make setup SDK=java ends on how to make Java your language, only once Java set up', () => {
  const dir = javaFixture(['java']);
  writeFileSync(join(dir, '.env'), '');
  const r = make(dir, ['setup', 'SDK=java']);
  assert.equal(r.status, 0, r.text);
  assert.ok(r.stubs.includes('STUB mission.sh setup'), r.text);
  assert.equal(r.lines.at(-1), 'To make Java your language: make use java', r.text);
  assert.ok(!r.text.includes('To run a mission, install') && !r.text.includes(PICK), r.text);
  const both = make(javaFixture(), ['setup', 'SDK=py java']);
  assert.equal(both.lines.at(-1), 'To make Java your language: make use java', both.text);

  // No JDK: Java is skipped, and the skip line is the last word.
  const nojdk = javaFixture(['uv', 'pnpm']);
  writeFileSync(join(nojdk, '.env'), '');
  const skipped = make(nojdk, ['setup', 'SDK=java']);
  assert.equal(skipped.status, 0, skipped.text);
  assert.equal(skipped.lines.at(-1), 'Skipping Java: it needs a JDK 17 or newer (https://adoptium.net).', skipped.text);
  assert.ok(!skipped.text.includes('your language'), skipped.text);
  const pyOnly = make(nojdk, ['setup', 'SDK=py java']);
  assert.ok(pyOnly.stubs.includes('STUB uv sync'), pyOnly.text);
  assert.ok(!pyOnly.text.includes('To make Java your language'), pyOnly.text);

  save(dir, 'java\n');
  const saved_ = make(dir, ['setup', 'SDK=java']);
  assert.equal(saved_.lines.at(-1), `Your language: Java (saved in .workshop-lang). To switch: ${switchFrom('java')}`, saved_.text);
  const py = make(javaFixture(), ['setup', 'SDK=py']);
  assert.equal(py.lines.at(-1), PICK, 'an AUTO_LANGS language keeps the usual last line');
});

test('java i) no uv and no pnpm: make use names Java\'s way in and probes nothing; a saved java then runs', () => {
  const dir = javaFixture(['java']);
  const use = make(dir, ['use']);
  assert.equal(use.status, 0, use.text);
  assert.deepEqual(use.lines, [NONE]);
  assert.ok(NONE.endsWith(` For Java: with a JDK 17 or newer (${JDK_SITE}), run make use java, then make setup.`),
    NONE);
  const ci = make(dir, ['-k', 'ci']);
  assert.notEqual(ci.status, 0, ci.text);
  assert.ok(ci.lines.includes(`${NONE_BASE} For Java: make ci SDK=java.`), ci.text);
  const check = make(dir, ['check', '00']);
  assert.equal(check.status, 2);
  assert.ok(check.lines.includes(NONE), check.text);
  assert.equal(javaCalls(dir), '', 'listing Java never probes it');

  const pick = make(dir, ['use', 'java']);
  assert.equal(pick.status, 0, pick.text);
  const savedLine = 'Saved: Java. make check, run and live use it now. Add SDK=py to run one command in Python.';
  assert.ok(pick.lines.includes(savedLine), pick.text);
  assert.ok(!pick.lines.includes(NEEDS_JDK), pick.text);
  const r = make(dir, ['check', '00']);
  assert.equal(r.status, 0, r.text);
  assert.deepEqual(r.stubs, ['STUB mission.sh check 00-first-words']);
  assert.notEqual(javaCalls(dir), '', 'a picked Java is probed');
});

test('java j) in Codespaces or the dev container, the needs-a-JDK lines give the apt command', () => {
  const NEEDS_APT = `Java needs a JDK 17 or newer (${JDK_APT}), which isn't installed. `
    + 'Install it, then run make setup.';
  for (const env of [{ CODESPACES: 'true' }, { DEVCONTAINER: 'true' }]) {
    const dir = javaFixture(['uv', 'pnpm']);
    const use = make(dir, ['use', 'java'], env);
    assert.equal(use.status, 0, use.text);
    assert.ok(use.lines.includes(NEEDS_APT), use.text);
    const r = make(dir, ['check', '00'], env);
    assert.equal(r.status, 2);
    assert.ok(r.lines.includes(NEEDS_APT), r.text);
    const setup = make(dir, ['setup', 'USE_HINT=0'], env);
    assert.equal(setup.status, 2, setup.text);
    assert.ok(setup.lines.includes(`Skipping Java: it needs a JDK 17 or newer (${JDK_APT}).`), setup.text);
    assert.equal(setup.lines.at(-2), NEEDS_APT);
    assert.ok(!`${use.text}${r.text}${setup.text}`.includes('adoptium'), 'no download link in a container');
  }
  // Elsewhere, the link to adoptium.net (test g covers it in full).
  const dir = javaFixture(['uv', 'pnpm']);
  assert.ok(make(dir, ['use', 'java']).lines.includes(NEEDS_JDK));
  // Python and TypeScript read the same in a container.
  const ts = make(fixture(['uv']), ['use', 'ts'], { CODESPACES: 'true' });
  assert.ok(ts.lines.includes(NEEDS_PNPM), ts.text);
  // java/mission.sh and java/pom.xml give the same apt line (MissionShTest runs mission.sh's).
  assert.equal(mvar('JDK_APT'), JDK_APT);
  const sh = readFileSync(join(ROOT, 'java/mission.sh'), 'utf8');
  assert.ok(sh.includes(`HOW_JDK="${JDK_APT}"`) && sh.includes('${CODESPACES:-}${DEVCONTAINER:-}'), 'mission.sh');
  const pom = readFileSync(join(ROOT, 'java/pom.xml'), 'utf8');
  assert.equal(pom.split(`<jdk.how>${JDK_APT.replaceAll('&', '&amp;')}</jdk.how>`).length - 1, 2, 'pom.xml');
  assert.ok(pom.includes('<name>env.CODESPACES</name>') && pom.includes('<name>env.DEVCONTAINER</name>'), 'pom.xml');
});
