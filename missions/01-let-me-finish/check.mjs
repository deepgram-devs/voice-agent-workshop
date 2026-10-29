// Mission 01 checks, shared by every language. Contract: CONTRIBUTING.md.

const BLOCK = 'agent.think_live.provider'; // the timing block

function inRange(v, lo, hi) {
  return typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
}

/** TODO 1 and TODO 2: what Settings has to carry. */
function settingsChecks(s, t) {
  const settings = s.settings;
  if (!t.ok(settings, 'Your program sends a Settings message after Welcome')) return null;
  const block = t.get(settings, BLOCK);
  t.ok(
    block &&
      block.type === 'deepgram' &&
      block.version === 'v1' &&
      inRange(block.agent_backchannel_sensitivity, 0, 1) &&
      inRange(block.presence_check_interval_ms, 1, 600000) &&
      inRange(block.presence_check_max_count, 0, 100),
    'TODO 1: add agent.think_live.provider: type "deepgram", version "v1", agent_backchannel_sensitivity (0 to 1), presence_check_interval_ms and presence_check_max_count',
  );
  const fns = t.get(settings, 'agent.think.functions');
  const endCall = Array.isArray(fns) ? fns.find((f) => f?.name === 'end_call') : null;
  t.ok(
    endCall && typeof endCall.description === 'string' && endCall.description.trim().length >= 10,
    'TODO 2: give end_call a description that says when to call it (a sentence)',
  );
  return settings;
}

/** Index in s.events of the client's FunctionCallResponse for end_call, or -1. */
function endCallResponseIndex(s) {
  return s.events.findIndex((e) => e.dir === 'client' && e.frame?.type === 'FunctionCallResponse' && e.frame.name === 'end_call');
}

function endCallRequestId(s) {
  for (const f of s.receivedOfType('FunctionCallRequest')) {
    const fn = (f.functions ?? []).find((x) => x?.name === 'end_call');
    if (fn) return fn.id;
  }
  return null;
}

export default {
  replay: [
    {
      name: 'goodbye',
      fixture: 'goodbye.jsonl',
      assert(s, t) {
        if (!settingsChecks(s, t)) return;
        if (!endCallRequestId(s)) {
          // Only possible when the program hung up before the caller said goodbye.
          t.fail('TODO 4: your program hung up before the agent asked for end_call. Close only after answering end_call');
          return;
        }
        const answered = endCallResponseIndex(s);
        const response = answered >= 0 ? s.events[answered].frame : null;
        t.ok(
          response && response.id === endCallRequestId(s),
          'TODO 3: when a FunctionCallRequest asks for end_call, send a FunctionCallResponse with the same id and name "end_call"',
        );
        // The goodbye's AgentAudioDone is the first one after your answer.
        const goodbyeDone = answered >= 0 ? s.indexOf('server', 'AgentAudioDone', answered + 1) : -1;
        const byYou = s.close?.by === 'client';
        t.ok(
          byYou && goodbyeDone >= 0 && s.close.at >= s.events[goodbyeDone].at,
          'TODO 4: after answering end_call, close the connection when the next AgentAudioDone arrives (the agent never hangs up by itself)',
        );
      },
    },
  ],
  live: {
    timeoutMs: 30000,
    // Once the greeting has played, the harness plays a caller who is done.
    script: [{ after: 'AgentAudioDone', delay_ms: 300, send: { type: 'InjectUserMessage', content: "That's everything, thanks. Okay, bye!" } }],
    assert(s, t) {
      settingsChecks(s, t);
      for (const e of s.receivedOfType('Error')) t.fail(`The agent sent an error: ${e.description ?? e.message ?? ''} (${e.code ?? 'no code'})`);
      t.ok(s.receivedOfType('SettingsApplied').length > 0, 'The agent accepted your Settings, timing block included (SettingsApplied)');
      t.ok(endCallRequestId(s), 'The agent called end_call after the caller said goodbye (check the function description and the prompt)');
      const answered = endCallResponseIndex(s);
      t.ok(answered >= 0, 'TODO 3: your program answered end_call with a FunctionCallResponse');
      t.ok(
        s.close?.by === 'client' && answered >= 0 && s.close.at >= s.events[answered].at,
        'TODO 4: your program hung up after answering end_call',
      );
    },
  },
};
