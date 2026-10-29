// Pins the two lines mission 03's live check prints when the agent refuses the
// filler (a Warning with one of the two INJECT_AGENT_MESSAGE_DURING_* codes),
// and that no other Warning earns a TODO 3 line. No harness process and no
// network: the check's live assert runs on a Session built by hand, because
// no fixture carries a Warning (every line a fixture prints is pinned).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Session, get } from '../lib/session.mjs';
import check from '../../../missions/03-no-dead-air/check.mjs';

const AGENT_SPEECH = 'INJECT_AGENT_MESSAGE_DURING_AGENT_SPEECH';
const USER_SPEECH = 'INJECT_AGENT_MESSAGE_DURING_USER_SPEECH';
const LINE = {
  [AGENT_SPEECH]: 'TODO 3: the agent refused your filler line (INJECT_AGENT_MESSAGE_DURING_AGENT_SPEECH). Send it with behavior "queue" so it waits its turn',
  [USER_SPEECH]: 'TODO 3: the agent refused your filler line (INJECT_AGENT_MESSAGE_DURING_USER_SPEECH): the caller was still talking when it went out. Nothing to change if it goes out the moment the request arrives (TODO 3); run it again',
};

/** The live assert's FAIL messages for a session whose only server frame is one Warning. */
function failuresFor(warning) {
  const s = new Session();
  s.addJson('client', { type: 'Settings', agent: { think: { functions: [{ name: 'deleteItem' }] } } });
  s.addJson('server', warning);
  const results = [];
  // The three methods the live assert reaches on this session; lib/assert.mjs has the real ones.
  const t = {
    ok(cond, message) { results.push({ pass: Boolean(cond), message }); return Boolean(cond); },
    fail(message) { results.push({ pass: false, message }); return false; },
    get,
  };
  check.live.assert(s, t);
  return results.filter((r) => !r.pass).map((r) => r.message);
}

test('03 live: a filler refused during agent speech prints the queue line, verbatim', () => {
  const fails = failuresFor({ type: 'Warning', code: AGENT_SPEECH, description: 'refused' });
  assert.deepEqual(fails.filter((m) => m.startsWith('TODO 3:')), [LINE[AGENT_SPEECH]]);
});

test('03 live: a filler refused during user speech prints the run-it-again line, verbatim', () => {
  const fails = failuresFor({ type: 'Warning', code: USER_SPEECH, description: 'refused' });
  assert.deepEqual(fails.filter((m) => m.startsWith('TODO 3:')), [LINE[USER_SPEECH]]);
});

test('03 live: another Warning code, or none, earns no TODO 3 line', () => {
  for (const warning of [{ type: 'Warning', code: 'VOICE_PROMPT_ADDED', description: 'x' }, { type: 'Warning', description: 'no code' }]) {
    const fails = failuresFor(warning);
    assert.equal(fails.some((m) => m.startsWith('TODO 3:')), false, JSON.stringify(fails));
  }
});
