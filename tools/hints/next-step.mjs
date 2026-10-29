#!/usr/bin/env node
// What to do after a passing `make check NN`. The Makefile runs this once every
// language it checked passed, with the file it checked in each:
//
//   node tools/hints/next-step.mjs <mission folder> [SDK=xx] [Name=path ...]
//
// SDK=xx goes into the next command as typed; each Name=path (Python=python/...)
// is a file that passed. Any order. It names no language of its own.
//
// It reads WORKSHOP_URL (the shell first, even empty; then .env) to link the mission's page on
// the workshop site, and WORKSHOP_IN_DOCKER (compose.yaml sets it) to add the docker
// compose form of the next command, on the service WORKSHOP_DOCKER_SERVICE names (workshop
// when unset). It reads no other variable and never prints a token or a key.

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One variable from a .env file's text, or ''. Quotes around the value are dropped. */
export function envValue(text, name) {
  for (const raw of String(text ?? '').split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(raw);
    if (!m || m[1] !== name) continue;
    let value = m[2].trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, '');
    return value.trim();
  }
  return '';
}

/** WORKSHOP_URL -> the workshop site's address (https://host/path, without /sdk and what follows it or a pasted page's /code, /resume or /m/<mission>; http:// for a local ws:// one), or ''. */
export function siteOf(workshopUrl) {
  const m = /^(wss|ws|https|http):\/\/([^/\s?#]+(?:\/[^\s?#]*)?)/.exec(String(workshopUrl ?? '').trim());
  if (!m) return '';
  return `${m[1] === 'ws' || m[1] === 'http' ? 'http' : 'https'}://${m[2].replace(/\/+$/, '').replace(/\/sdk(?:\/.*)?$/, '').replace(/\/(?:m\/.*|code|resume)$/, '')}`;
}

/** "00-first-words" -> "first-words", the mission's id on the workshop site. */
export function webId(missionDir) {
  return String(missionDir).replace(/^\d{2}-/, '');
}

/**
 * The lines to print after mission `missionDir` passes its offline check in `files`
 * ({ name, file }; the path is shown). `inDocker`: add the docker compose form of the
 * next command, for a reader who runs make through `docker compose run`, on `service`
 * (compose.yaml's workshop, or workshop-java).
 */
export function nextStep(missionDir, { sdkArg = '', files = [], workshopUrl = '', inDocker = false, service = 'workshop' } = {}) {
  const nn = String(missionDir).slice(0, 2);
  const sdk = sdkArg ? ` ${sdkArg}` : '';
  const passed = files.length
    ? files.map(({ file }) => `Mission ${nn} passes its offline check: ${file}`)
    : [`Mission ${nn} passes its offline check.`];
  // The one next step everywhere (README and briefs match it): run, then live. make run
  // needs a credential, which the check did not, so say so before the dev finds out. In the
  // workshop container the command is its docker compose form, as the README gives it.
  const make = inDocker ? `docker compose run --rm ${service} make` : 'make';
  const lines = [
    '',
    ...passed,
    `Next: ${make} run ${nn}${sdk} to talk to your agent (type a line, press Enter; Ctrl-D or Ctrl-C hangs up). ` +
      `It needs DEEPGRAM_API_KEY or your workshop token in .env. Then ${make} live ${nn}${sdk} runs the live check.`,
  ];
  const site = siteOf(workshopUrl);
  if (site) {
    // The map belongs to a handle: this #run-it link, in a browser without one, opens /resume first and
    // comes back (the app's missionGuard); any other mission link still joins a newcomer on the default path.
    lines.push(`Then see it on your map: ${site}/m/${webId(missionDir)}#run-it (in the browser that has your handle; played on your phone? open ${site}/resume on this laptop first).`);
    // #run-it opens the "Run it in your code" step, where the code checkpoint sits.
    lines.push(`On that page, tap I did this on "Your code passed make check ${nn}".`);
  }
  return lines;
}

/** The arguments after the mission folder: SDK=xx is the run argument, any other Name=path a file. */
export function parseArgs(args) {
  let sdkArg = '';
  const files = [];
  for (const arg of args) {
    const m = /^([^=]+)=(.+)$/.exec(arg);
    if (!m) continue;
    if (m[1] === 'SDK') sdkArg = arg;
    else files.push({ name: m[1], file: m[2] });
  }
  return { sdkArg, files };
}

function main() {
  const [missionDir, ...rest] = process.argv.slice(2);
  if (!missionDir) {
    console.error('usage: next-step.mjs <mission folder> [SDK=xx] [Name=path ...]');
    return 2;
  }
  const { sdkArg, files } = parseArgs(rest);
  // The shell first, then .env. A WORKSHOP_URL set in the shell wins even when it is empty: that
  // means "no site", as it does for the helpers (their .env never fills a variable the shell set),
  // and it is how hints.test.mjs keeps a developer's own .env out of its runs.
  let workshopUrl = process.env.WORKSHOP_URL?.trim() ?? '';
  const envFile = join(ROOT, '.env');
  if (!('WORKSHOP_URL' in process.env) && existsSync(envFile)) workshopUrl = envValue(readFileSync(envFile, 'utf8'), 'WORKSHOP_URL');
  const inDocker = Boolean(process.env.WORKSHOP_IN_DOCKER?.trim());
  const service = process.env.WORKSHOP_DOCKER_SERVICE?.trim() || 'workshop';
  for (const line of nextStep(missionDir, { sdkArg, files, workshopUrl, inDocker, service })) console.log(line);
  return 0;
}

// Started directly, not imported by a test. Real paths, as typescript/src/common.ts isMain:
// a symlinked checkout or a drive letter in another case still runs.
function isMain() {
  if (!process.argv[1]) return false;
  const real = (path) => {
    try {
      return realpathSync.native(path);
    } catch {
      return path;
    }
  };
  const self = real(fileURLToPath(import.meta.url));
  const started = real(resolve(process.argv[1]));
  return process.platform === 'win32' ? self.toLowerCase() === started.toLowerCase() : self === started;
}

if (isMain()) process.exitCode = main();
