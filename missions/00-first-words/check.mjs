// Mission 00 checks, shared by every language. Contract: CONTRIBUTING.md.

// What the start files ship with. A check fails until the attendee changes them.
const STARTER_PROMPT = 'You are a helpful assistant.';
const STARTER_VOICE = 'flux-hannah-en';

function settingsShape(s, t) {
  const settings = s.settings;
  if (!t.ok(settings, 'Your program sends a Settings message after Welcome')) return null;
  const firstReal = s.sent.find((f) => f.type !== 'KeepAlive');
  t.equal(firstReal?.type, 'Settings', 'Settings is the first message you send');
  t.has(settings, 'audio.input.encoding', 'Settings has audio.input (encoding and sample_rate)');
  t.has(settings, 'audio.output.encoding', 'Settings has audio.output');
  t.has(settings, 'agent.listen.provider.model', 'Settings has agent.listen.provider.model');
  t.has(settings, 'agent.think.provider.type', 'Settings has agent.think.provider');
  return settings;
}

export default {
  replay: [
    {
      name: 'greeting',
      fixture: 'greeting.jsonl',
      assert(s, t) {
        const settings = settingsShape(s, t);
        if (!settings) return;
        const prompt = t.get(settings, 'agent.think.prompt');
        t.ok(typeof prompt === 'string' && prompt.trim() !== STARTER_PROMPT, 'TODO 1: the prompt is your own, not the starter one');
        t.ok(typeof prompt === 'string' && prompt.trim().length >= 20, 'TODO 1: the prompt is at least a sentence (20+ characters)');
        const voice = t.get(settings, 'agent.speak.provider.model');
        t.ok(typeof voice === 'string' && voice && voice !== STARTER_VOICE, `TODO 2: you picked a voice other than ${STARTER_VOICE}`);
        t.has(settings, 'agent.greeting', 'TODO 3: agent.greeting is set');
        t.ok(s.agentLines.some((l) => typeof l === 'string' && l.trim()), 'TODO 3: the agent says your greeting back to you');
      },
    },
  ],
  live: {
    timeoutMs: 20000,
    // Without a greeting the agent waits for you, so the harness says hello if
    // nothing has been said two seconds after SettingsApplied.
    script: [{ after: 'SettingsApplied', delay_ms: 2000, send: { type: 'InjectUserMessage', content: 'Hello! Who are you?' } }],
    until: (s) => s.receivedOfType('SettingsApplied').length > 0 && s.agentLines.length > 0,
    assert(s, t) {
      settingsShape(s, t);
      for (const e of s.receivedOfType('Error')) t.fail(`The agent sent an error: ${e.description ?? e.message ?? ''} (${e.code ?? 'no code'})`);
      t.ok(s.receivedOfType('SettingsApplied').length > 0, 'The agent accepted your Settings (SettingsApplied)');
      t.ok(s.agentLines.length > 0, 'The agent spoke (an assistant ConversationText arrived)');
    },
  },
};
