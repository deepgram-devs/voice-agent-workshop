// Mission 02 checks, shared by every language. Contract: CONTRIBUTING.md.
//
// Everything here is checked from the wire, not self-reported: the
// FrustrationDetected events the server sent and the UpdatePrompt frames your
// program sent back, in order.

// The timing block's wire key in Settings.agent.
const TIMING = 'think_live';

// LIVE_AUDIO=1 plays recorded complaints instead of typing them (fixtures/audio/README.md).
const AUDIO = process.env.LIVE_AUDIO === '1';
const TYPED_SCRIPT = [
  { after: 'SettingsApplied', delay_ms: 500, send: { type: 'InjectUserMessage', content: 'Where do I pick up my badge?' } },
  { after: 'SettingsApplied', delay_ms: 7000, send: { type: 'InjectUserMessage', content: 'I was just there and they sent me back here. This is ridiculous.' } },
  { after: 'SettingsApplied', delay_ms: 14000, send: { type: 'InjectUserMessage', content: 'Seriously? Listen to me. I have asked three times now. Ugh.' } },
  { after: 'SettingsApplied', delay_ms: 21000, send: { type: 'InjectUserMessage', content: 'Wrong again! This is so frustrating. I am done with this.' } },
];
const AUDIO_SCRIPT = [
  { after: 'SettingsApplied', delay_ms: 500, send_audio: 'fixtures/audio/02-annoyed-1.wav' },
  { after: 'AgentAudioDone', nth: 1, delay_ms: 300, send_audio: 'fixtures/audio/02-annoyed-2.wav' },
  { after: 'AgentAudioDone', nth: 2, delay_ms: 300, send_audio: 'fixtures/audio/02-annoyed-3.wav' },
];

function timingShape(s, t) {
  const settings = s.settings;
  if (!t.ok(settings, 'Your program sends a Settings message after Welcome')) return null;
  t.has(settings, 'agent.think.prompt', 'Settings has agent.think.prompt');
  const block = t.has(settings, `agent.${TIMING}.provider.type`, `Settings has the timing block (agent.${TIMING}.provider)`);
  if (!block) return null;
  const limit = t.get(settings, `agent.${TIMING}.provider.frustration_max_count`);
  t.ok(Number.isInteger(limit) && limit >= 1 && limit <= 5, 'TODO 1: set frustration_max_count to a whole number from 1 to 5');
  return settings;
}

/** Index in s.events of the first server FrustrationDetected with escalated true, or -1. */
function firstEscalation(s) {
  return s.events.findIndex((e) => e.dir === 'server' && e.frame?.type === 'FrustrationDetected' && e.frame.escalated === true);
}

/** The recovery must not repeat the base prompt: UpdatePrompt adds to it. */
function recoveryText(s, t, update) {
  const prompt = typeof update?.prompt === 'string' ? update.prompt.trim() : '';
  t.ok(prompt.length >= 20, 'TODO 2: the recovery says what to do now (20+ characters)');
  const base = String(t.get(s.settings, 'agent.think.prompt') ?? '').trim();
  t.ok(!base || !prompt.includes(base), 'TODO 2: UpdatePrompt adds to the prompt the agent already has, so send only the new lines, not the whole prompt again');
}

export default {
  replay: [
    {
      // Three frustrated turns. The server escalates on the second and stays escalated.
      name: 'three-strikes',
      fixture: 'three-strikes.jsonl',
      assert(s, t) {
        if (!timingShape(s, t)) return;
        const events = s.receivedOfType('FrustrationDetected');
        t.equal(events.length, 3, 'The replay delivered all three FrustrationDetected events to your program');
        const updates = s.sentOfType('UpdatePrompt');
        t.equal(updates.length, 1, `TODO 3: send exactly one UpdatePrompt for the whole call (you sent ${updates.length})`);
        t.before(firstEscalation(s), s.indexOf('client', 'UpdatePrompt'), 'TODO 3: wait for the first FrustrationDetected with escalated true before you send the recovery');
        if (updates.length) recoveryText(s, t, updates[0]);
      },
    },
    {
      // Two frustrated turns that never reach the limit: the recovery must stay unsent.
      name: 'never-escalates',
      fixture: 'never-escalates.jsonl',
      assert(s, t) {
        if (!timingShape(s, t)) return;
        t.equal(s.receivedOfType('FrustrationDetected').length, 2, 'The replay delivered both FrustrationDetected events to your program');
        const updates = s.sentOfType('UpdatePrompt');
        t.equal(updates.length, 0, `TODO 3: no UpdatePrompt while escalated is false (you sent ${updates.length})`);
      },
    },
  ],
  live: {
    timeoutMs: AUDIO ? 75000 : 45000,
    // The harness plays an annoyed caller. Typed by default: four complaints, a
    // few seconds apart. With LIVE_AUDIO=1 it plays three recorded complaints
    // (fixtures/audio/), each after the agent's previous answer has played.
    // Real speech is what triggers FrustrationDetected most reliably.
    script: AUDIO ? AUDIO_SCRIPT : TYPED_SCRIPT,
    until: (s) => {
      const lastHarness = s.events.findLastIndex((e) => e.dir === 'harness');
      const answeredLast = lastHarness >= 0 && s.events.slice(lastHarness).some((e) => e.dir === 'server' && e.frame?.type === 'ConversationText' && e.frame.role === 'assistant');
      return s.events.filter((e) => e.dir === 'harness').length === (AUDIO ? AUDIO_SCRIPT : TYPED_SCRIPT).length && answeredLast;
    },
    grace_ms: 1500,
    assert(s, t) {
      timingShape(s, t);
      for (const e of s.receivedOfType('Error')) {
        const code = e.code ?? 'no code';
        const hint = code === 'UNPARSABLE_CLIENT_MESSAGE' ? " This mission uses the `timing` feature. Run it with a workshop token, or finish it with make check 02." : '';
        t.fail(`The agent sent an error: ${e.description ?? e.message ?? ''} (${code}).${hint}`);
      }
      t.ok(s.receivedOfType('SettingsApplied').length > 0, 'The agent accepted your Settings, timing block included (SettingsApplied)');
      t.ok(s.agentLines.length > 0, 'The agent answered the caller');
      if (AUDIO) t.ok(s.userLines.length > 0, 'The agent heard the recorded caller (a user ConversationText from the audio)');
      const updates = s.sentOfType('UpdatePrompt');
      const escalated = firstEscalation(s);
      if (escalated >= 0) {
        t.equal(updates.length, 1, `TODO 3: send exactly one UpdatePrompt once escalated is true (you sent ${updates.length})`);
        t.before(escalated, s.indexOf('client', 'UpdatePrompt'), 'TODO 3: wait for the first FrustrationDetected with escalated true before you send the recovery');
        if (updates.length) recoveryText(s, t, updates[0]);
      } else {
        t.equal(updates.length, 0, `TODO 3: no UpdatePrompt while escalated is false (you sent ${updates.length})`);
        // Typed and synthetic turns rarely produce FrustrationDetected, so the offline
        // replay proves the escalation path. The note says which one this run covered.
        if (s.receivedOfType('FrustrationDetected').length === 0) {
          const from = AUDIO ? 'recorded turns' : 'typed turns';
          t.ok(true, `Note: no FrustrationDetected arrived from ${from}, so this live run covers Settings only; make check 02 covers the recovery`);
        }
      }
    },
  },
};
