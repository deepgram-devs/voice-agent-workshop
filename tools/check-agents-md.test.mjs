// node --test tools/check-agents-md.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { check, DOCS_INDEX, publishedPages } from './check-agents-md.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const GOOD_LINK =
  'https://console.deepgram.com/signup?utm_source=workshops&utm_medium=agent&utm_campaign=workshop-voice-agent&utm_content=agents-md-signup';
const good = `- **No Deepgram key yet?** Send the person to ${GOOD_LINK}. Never ask to see the key.\n- Docs index for agents: ${DOCS_INDEX}\n`;

test('the repo as it is passes', () => {
  const read = (f) => readFileSync(join(ROOT, f), 'utf8');
  const pages = Object.fromEntries(publishedPages().filter((f) => f !== 'AGENTS.md').map((f) => [f, read(f)]));
  assert.deepEqual(check(read('AGENTS.md'), pages), []);
  assert.ok(Object.keys(pages).includes('README.md'));
});

test('a minimal good AGENTS.md passes', () => {
  assert.deepEqual(check(good), []);
});

test('the old MCP address fails, in AGENTS.md or another page', () => {
  assert.match(check(`${good}- MCP: https://developers.deepgram.com/_mcp/server\n`).join('\n'), /AGENTS\.md:3: names the old docs MCP address/);
  assert.match(check(good, { 'README.md': 'x\n[mcp](https://developers.deepgram.com/_mcp/server)' }).join('\n'), /README\.md:2:/);
});

test('each of the four UTM parameters is required, with its exact value', () => {
  for (const [k, v] of [
    ['utm_source', 'workshops'],
    ['utm_medium', 'agent'],
    ['utm_campaign', 'workshop-voice-agent'],
    ['utm_content', 'agents-md-signup'],
  ]) {
    const without = good.replace(`${k}=${v}`, `${k}=other`);
    assert.match(check(without).join('\n'), new RegExp(`needs ${k}=${v} \\(has other\\)`), k);
    const dropped = good.replace(new RegExp(`[?&]${k}=${v}`), (m) => (m[0] === '?' ? '?' : ''));
    assert.match(check(dropped).join('\n'), new RegExp(`needs ${k}=${v}`), `${k} dropped`);
  }
});

test('no signup link, no docs index or no no-key rule fails', () => {
  assert.match(check(good.replace(GOOD_LINK, 'the console')).join('\n'), /no signup link/);
  assert.match(check(good.replace(DOCS_INDEX, 'the docs')).join('\n'), /no link to the docs index/);
  assert.match(check(good.replace('No Deepgram key yet?', 'Keys:')).join('\n'), /the no-key rule/);
});
