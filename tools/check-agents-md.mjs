#!/usr/bin/env node
// AGENTS.md checks, run in CI (ci.yml, the repo-files job):
//
//   node tools/check-agents-md.mjs
//
// - AGENTS.md sends agents to the docs index, https://developers.deepgram.com/llms.txt.
// - No published page names the old docs MCP address (developers.deepgram.com/_mcp/server):
//   it no longer answers, so an agent that follows it stalls.
// - AGENTS.md has the no-key rule: a console signup link carrying all four UTM
//   parameters with these exact values, so a signup from a coding agent is counted as
//   one. The values are written out by hand: this repo stands alone and imports
//   nothing from the workshop site.
//
// Prints one line per problem and exits 1, or prints one OK line and exits 0.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

export const DOCS_INDEX = 'https://developers.deepgram.com/llms.txt';
export const SIGNUP = 'https://console.deepgram.com/signup';
export const SIGNUP_UTM = Object.freeze({
  utm_source: 'workshops',
  utm_medium: 'agent',
  utm_campaign: 'workshop-voice-agent',
  utm_content: 'agents-md-signup',
});
const DEAD = /_mcp\/server/;

/** The pages an agent or a person reads: AGENTS.md, README.md, PARTNERS.md and docs/. */
export function publishedPages(root = ROOT) {
  const docs = existsSync(join(root, 'docs'))
    ? readdirSync(join(root, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)
    : [];
  return ['AGENTS.md', 'README.md', 'PARTNERS.md', ...docs.sort()].filter((f) => existsSync(join(root, f)));
}

/** Problems with AGENTS.md's text (and the dead address anywhere in `pages`). */
export function check(agents, pages = {}) {
  const problems = [];
  if (!agents.includes(DOCS_INDEX)) problems.push(`AGENTS.md: no link to the docs index, ${DOCS_INDEX}`);
  for (const [file, text] of Object.entries({ 'AGENTS.md': agents, ...pages })) {
    text.split('\n').forEach((line, i) => {
      if (DEAD.test(line)) problems.push(`${file}:${i + 1}: names the old docs MCP address (_mcp/server); point at ${DOCS_INDEX} instead`);
    });
  }
  const links = [...agents.matchAll(/https:\/\/console\.deepgram\.com\/signup\b[^\s)<>"'`]*/g)].map((m) => m[0].replace(/[.,;:]+$/, ''));
  if (!links.length) problems.push(`AGENTS.md: no signup link (${SIGNUP}?…) for a person with no key yet`);
  for (const link of links) {
    const params = new URL(link).searchParams;
    for (const [k, v] of Object.entries(SIGNUP_UTM)) {
      if (params.get(k) !== v) problems.push(`AGENTS.md: the signup link ${link} needs ${k}=${v}${params.has(k) ? ` (has ${params.get(k)})` : ''}`);
    }
  }
  if (!/no deepgram key yet\?/i.test(agents)) problems.push('AGENTS.md: the no-key rule ("No Deepgram key yet? Send the person to …") is missing');
  return problems;
}

function main() {
  const read = (f) => readFileSync(join(ROOT, f), 'utf8');
  const pages = Object.fromEntries(publishedPages().filter((f) => f !== 'AGENTS.md').map((f) => [f, read(f)]));
  const problems = check(read('AGENTS.md'), pages);
  for (const p of problems) console.error(p);
  if (problems.length) return 1;
  console.log(`AGENTS.md: docs index, no-key signup link with all four UTM parameters; no _mcp/server in ${Object.keys(pages).length + 1} pages`);
  return 0;
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) process.exitCode = main();
