// Mission 04 checks, shared by every language. Contract: CONTRIBUTING.md.

const MULTI_MODEL = 'flux-general-multi';
// The Spanish voice id carries the language code ("aura-2-celeste-es"). A voice
// id without one needs a looser pattern here.
const SPANISH_VOICE = /(^|[-_])es($|[-_])/;
// The workshop app's default hints. A run whose hints are exactly these
// doesn't count as setting hints there, so the check asks for a list of your own.
const DEFAULT_HINTS = ['en', 'es'];

function settingsShape(s, t) {
  const settings = s.settings;
  if (!t.ok(settings, 'Your program sends a Settings message after Welcome')) return null;
  const firstReal = s.sent.find((f) => f.type !== 'KeepAlive');
  t.equal(firstReal?.type, 'Settings', 'Settings is the first message you send');
  t.has(settings, 'agent.speak.provider.model', 'Settings has agent.speak.provider.model');
  const model = t.get(settings, 'agent.listen.provider.model');
  const hints = t.get(settings, 'agent.listen.provider.language_hints');
  const valid = Array.isArray(hints) && hints.length >= 2 && hints.every((h) => typeof h === 'string' && h.trim());
  const isDefault = valid && hints.length === DEFAULT_HINTS.length && DEFAULT_HINTS.every((h) => hints.includes(h));
  t.ok(
    model === MULTI_MODEL && valid && !isDefault,
    `TODO 1: listen with ${MULTI_MODEL} and give language_hints at least two languages of your own choosing, not just "en" and "es" (for example "en", "es" and "fr")`,
  );
  return settings;
}

/** Position in s.events of the first user turn whose main language is `lang`. */
function userTurnIn(s, lang) {
  return s.events.findIndex(
    (e) => e.dir === 'server' && e.frame?.type === 'ConversationText' && e.frame.role === 'user' && String(e.frame.languages?.[0] ?? '').startsWith(lang),
  );
}

// LIVE_AUDIO=1 plays recorded callers instead of a typed line (fixtures/audio/README.md).
const AUDIO = process.env.LIVE_AUDIO === '1';
const ENGLISH_VOICE = /(^|[-_])en($|[-_])/;

function updatesSent(s) {
  return s.events.flatMap((e, i) => (e.dir === 'client' && e.frame?.type === 'UpdateSpeak' ? [{ i, frame: e.frame }] : []));
}

/** The live audio path: Spanish, then English, each heard and each followed by a voice switch. */
function audioSwitchChecks(s, t) {
  const es = userTurnIn(s, 'es');
  if (!t.ok(es >= 0, 'The listener heard the Spanish clip as Spanish (a user turn with languages[0] "es")')) return;
  const updates = updatesSent(s);
  const toSpanish = updates.find((u) => u.i > es);
  t.ok(toSpanish && SPANISH_VOICE.test(String(t.get(toSpanish.frame, 'speak.provider.model'))), 'TODO 2: after the Spanish turn, send UpdateSpeak with the Spanish voice (VOICES["es"])');
  t.ok(toSpanish && s.indexOf('server', 'SpeakUpdated', toSpanish.i) >= 0, 'The agent accepted the Spanish voice (SpeakUpdated)');
  const en = s.events.findIndex((e, i) => i > es && e.dir === 'server' && e.frame?.type === 'ConversationText' && e.frame.role === 'user' && String(e.frame.languages?.[0] ?? '').startsWith('en'));
  if (!t.ok(en >= 0, 'The listener heard the English clip as English (a user turn with languages[0] "en")')) return;
  const toEnglish = updates.find((u) => u.i > en);
  t.ok(toEnglish && ENGLISH_VOICE.test(String(t.get(toEnglish.frame, 'speak.provider.model'))), 'TODO 2: when the caller goes back to English, switch back to the English voice');
}

export default {
  replay: [
    {
      name: 'switch',
      fixture: 'switch.jsonl',
      assert(s, t) {
        const settings = settingsShape(s, t);
        if (!settings) return;
        const updates = updatesSent(s);
        if (!t.ok(updates.length > 0, 'TODO 2: when a user turn comes back in a new language (languages[0] is "es"), send UpdateSpeak with that language\'s voice')) return;
        t.equal(updates.length, 1, 'TODO 2: switch once. English, then Spanish, then Spanish again needs exactly one UpdateSpeak');
        const first = updates[0];
        t.ok(first.i > userTurnIn(s, 'es'), 'TODO 2: send UpdateSpeak after the Spanish turn arrives, not before');
        const model = t.get(first.frame, 'speak.provider.model');
        t.ok(typeof model === 'string' && model !== t.get(settings, 'agent.speak.provider.model'), 'TODO 2: UpdateSpeak asks for a different voice from the one in Settings');
        t.match(model, SPANISH_VOICE, 'TODO 2: UpdateSpeak asks for the Spanish voice (VOICES["es"])');
      },
    },
    {
      // A failed UpdateSpeak ends the call: the server closes the connection right
      // after the Error (live runs, 2026-10-06). The replay waits
      // 1.5 s before it closes, so it can see whether your program hangs up itself.
      name: 'voice-error',
      fixture: 'voice-error.jsonl',
      assert(s, t) {
        if (!settingsShape(s, t)) return;
        const updates = updatesSent(s);
        if (!t.ok(updates.length > 0, 'TODO 3: handle a failed voice switch. Finish TODO 2 first: this check starts from your UpdateSpeak')) return;
        const error = s.indexOf('server', 'Error');
        if (!t.ok(error >= 0, 'Your program keeps the call open until the server answers the switch')) return;
        const after = s.events.slice(error + 1).filter((e) => e.dir === 'client' && e.frame && e.frame.type !== 'KeepAlive');
        t.equal(
          after.map((e) => e.frame.type),
          [],
          'TODO 3: after the Error, send nothing more: no second UpdateSpeak and no other message. The call is over',
        );
        t.ok(
          s.close?.by === 'client' && s.close.at >= s.events[error].at,
          'TODO 3: when a voice switch gets an Error, print one clear line (which voice, and why) and hang up with agent.close(). The server ends the call after this error anyway',
        );
      },
    },
  ],
  live: {
    timeoutMs: AUDIO ? 45000 : 20000,
    // Typed turns carry no detected `languages` (checked 2026-10-06), so the typed
    // live check can't trigger the voice switch: it checks that the multilingual
    // listener is accepted and that the agent answers a Spanish line.
    // LIVE_AUDIO=1 plays a recorded Spanish caller, then an English one, after the
    // agent's Spanish answer has played. That path checks the switch both ways.
    script: AUDIO
      ? [
          { after: 'SettingsApplied', delay_ms: 500, send_audio: 'fixtures/audio/04-spanish.wav' },
          { after: 'AgentAudioDone', nth: 1, delay_ms: 300, send_audio: 'fixtures/audio/04-english.wav' },
        ]
      : [{ after: 'SettingsApplied', delay_ms: 500, send: { type: 'InjectUserMessage', content: 'Hola, ¿me puede ayudar con el horario, por favor?' } }],
    until: AUDIO
      ? (s) => s.receivedOfType('AgentAudioDone').length >= 2
      : (s) => s.receivedOfType('SettingsApplied').length > 0 && s.agentLines.length > 0,
    grace_ms: AUDIO ? 1000 : 500,
    assert(s, t) {
      settingsShape(s, t);
      for (const e of s.receivedOfType('Error')) t.fail(`The agent sent an error: ${e.description ?? e.message ?? ''} (${e.code ?? 'no code'})`);
      t.ok(s.receivedOfType('SettingsApplied').length > 0, 'The agent accepted your Settings (SettingsApplied)');
      t.ok(s.agentLines.length > 0, AUDIO ? 'The agent answered the recorded caller' : 'The agent answered your Spanish line');
      if (AUDIO) audioSwitchChecks(s, t);
    },
  },
};
