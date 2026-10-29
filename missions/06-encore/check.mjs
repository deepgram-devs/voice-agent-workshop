// Mission 06 checks, shared by every language. Contract: CONTRIBUTING.md.

// What the start files ship with. A check fails until the attendee changes them.
const STARTER_PROMPT = 'You are a helpful assistant.';
const SPEED_MIN = 0.85;
const SPEED_MAX = 1.15;
const NARRATE = 'A squirrel just ran off with my sandwich.';

function voiceChecks(s, t) {
  const settings = s.settings;
  if (!t.ok(settings, 'Your program sends a Settings message after Welcome')) return null;
  const firstReal = s.sent.find((f) => f.type !== 'KeepAlive');
  t.equal(firstReal?.type, 'Settings', 'Settings is the first message you send');
  const provider = t.get(settings, 'agent.speak.provider') ?? {};
  t.ok(
    typeof provider.model === 'string' && provider.model.startsWith('flux-') && provider.version === 'v2',
    'Keep a Flux voice (a flux-... model with version "v2"): Speed and Expressivity in this form belong to Flux voices',
  );
  return { settings, provider };
}

/** Agent lines expected before the typed line: the greeting, when there is one. */
const greeted = (s) => (s.settings?.agent?.greeting ? 1 : 0);

export default {
  replay: [
    {
      name: 'performance',
      fixture: 'performance.jsonl',
      assert(s, t) {
        const got = voiceChecks(s, t);
        if (!got) return;
        const { settings, provider } = got;
        const prompt = t.get(settings, 'agent.think.prompt');
        t.ok(typeof prompt === 'string' && prompt.trim() !== STARTER_PROMPT, 'TODO 1: the prompt asks for a performance of your own, not the starter one');
        t.ok(typeof prompt === 'string' && prompt.trim().length >= 20, 'TODO 1: the prompt is at least a sentence (20+ characters)');
        const speed = provider.speed;
        const onStep = typeof speed === 'number' && Math.abs(speed * 20 - Math.round(speed * 20)) < 1e-6;
        t.ok(typeof speed === 'number' && speed !== 1, 'TODO 2: set agent.speak.provider.speed to something other than 1');
        t.ok(
          typeof speed === 'number' && speed >= SPEED_MIN - 1e-9 && speed <= SPEED_MAX + 1e-9 && onStep,
          `TODO 2: speed is from ${SPEED_MIN} to ${SPEED_MAX}, in steps of 0.05`,
        );
        const expressivity = provider.expressivity;
        t.ok(Number.isInteger(expressivity) && expressivity !== 0, 'TODO 3: set agent.speak.provider.expressivity to a whole number other than 0');
        t.ok(Number.isInteger(expressivity) && expressivity >= -2 && expressivity <= 2, 'TODO 3: expressivity is a whole number from -2 to 2');
      },
    },
  ],
  live: {
    timeoutMs: 25000,
    script: [{ after: 'SettingsApplied', delay_ms: 1500, send: { type: 'InjectUserMessage', content: NARRATE } }],
    // Done once the agent has spoken after the typed line (its greeting, if any, comes first).
    until: (s) => s.receivedOfType('SettingsApplied').length > 0 && s.agentLines.length > greeted(s) && s.audioBytesReceived > 0,
    assert(s, t) {
      voiceChecks(s, t);
      for (const e of s.receivedOfType('Error')) t.fail(`The agent sent an error: ${e.description ?? e.message ?? ''} (${e.code ?? 'no code'})`);
      t.ok(s.receivedOfType('SettingsApplied').length > 0, 'The agent accepted your Settings, Speed and Expressivity included (SettingsApplied)');
      t.ok(s.agentLines.length > greeted(s), 'The agent performed a line (an assistant ConversationText after yours)');
      t.ok(s.audioBytesReceived > 0, 'The agent answered with audio');
    },
  },
};
