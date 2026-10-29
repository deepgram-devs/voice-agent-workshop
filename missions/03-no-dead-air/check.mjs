// Mission 03 checks, shared by every language. Contract: CONTRIBUTING.md.
//
// Everything here is checked from the wire, not self-reported: the
// FunctionCallRequest the server sent, and what your program sent back and when.
// The optional thinking stretch is not checked.

// The filler has to go out as soon as the request arrives, before the slow
// tool starts. Anything later than this and the caller already heard silence.
const FILLER_WITHIN_MS = 1000;

// A refused InjectAgentMessage comes back as a Warning with one of these codes
// (listed under Warning on the Voice Agent errors and warnings page). A refusal
// is never a message of its own type: no session or fixture carries one.
const REFUSED_FILLER = new Set(['INJECT_AGENT_MESSAGE_DURING_USER_SPEECH', 'INJECT_AGENT_MESSAGE_DURING_AGENT_SPEECH']);

function functionsShape(s, t) {
  const settings = s.settings;
  if (!t.ok(settings, 'Your program sends a Settings message after Welcome')) return null;
  const functions = t.get(settings, 'agent.think.functions');
  const names = Array.isArray(functions) ? functions.map((f) => f?.name) : [];
  t.ok(names.includes('deleteItem'), 'Settings declares the deleteItem function in agent.think.functions');
  return settings;
}

/** Each FunctionCallRequest call from the server, with where it arrived in s.events. */
function requestedCalls(s) {
  const calls = [];
  s.events.forEach((e, i) => {
    if (e.dir === 'server' && e.frame?.type === 'FunctionCallRequest') {
      for (const fn of e.frame.functions ?? []) calls.push({ ...fn, index: i, at: e.at });
    }
  });
  return calls;
}

/** The first FunctionCallResponse your program sent for this function name, with its place in s.events. */
function responseFor(s, name) {
  const i = s.events.findIndex((e) => e.dir === 'client' && e.frame?.type === 'FunctionCallResponse' && e.frame.name === name);
  return i < 0 ? null : { ...s.events[i].frame, index: i, at: s.events[i].at };
}

/** TODO 2: the response answers this exact request. */
function sameId(t, call, response) {
  t.equal(response.id, call.id, `TODO 2: the FunctionCallResponse carries the id from the request ("${call.id}")`);
}

/** TODO 3: a filler line before the slow tool's response, sent as soon as the request arrived. */
function coveredTheWait(s, t, call, response) {
  const i = s.events.findIndex((e, n) => n > call.index && e.dir === 'client' && e.frame?.type === 'InjectAgentMessage');
  if (!t.ok(i >= 0, 'TODO 3: send an InjectAgentMessage filler line when the slow tool is requested')) return;
  const inject = s.events[i];
  t.ok(typeof inject.frame.message === 'string' && inject.frame.message.trim(), 'TODO 3: the filler line has something to say');
  t.before(i, response.index, 'TODO 3: send the filler line before the tool result (FunctionCallResponse)');
  t.ok(inject.at - call.at <= FILLER_WITHIN_MS, `TODO 3: send the filler as soon as the request arrives, before the slow tool runs (it went out after ${inject.at - call.at} ms)`);
}

export default {
  replay: [
    {
      // "Delete milk": the slow tool. Three seconds between request and result.
      name: 'slow-delete',
      fixture: 'slow-delete.jsonl',
      assert(s, t) {
        if (!functionsShape(s, t)) return;
        const call = requestedCalls(s).find((c) => c.name === 'deleteItem');
        if (!t.ok(call, 'The replay delivered the deleteItem request to your program')) return;
        const response = responseFor(s, 'deleteItem');
        if (!t.ok(response, 'Your program answered the deleteItem request with a FunctionCallResponse')) return;
        const content = typeof response.content === 'string' ? response.content.trim() : '';
        t.ok(content && content !== 'TODO', 'TODO 1: deleteItem returns what it did, for example: Deleted "Buy milk". 2 items on the list.');
        t.match(content, /milk/i, 'TODO 1: the deleteItem result names the item it deleted (milk)');
        sameId(t, call, response);
        coveredTheWait(s, t, call, response);
      },
    },
    {
      // "What's on my list?": a quick tool. No filler needed, but the answer still has to match.
      name: 'quick-list',
      fixture: 'quick-list.jsonl',
      assert(s, t) {
        if (!functionsShape(s, t)) return;
        const call = requestedCalls(s).find((c) => c.name === 'listItems');
        if (!t.ok(call, 'The replay delivered the listItems request to your program')) return;
        const response = responseFor(s, 'listItems');
        if (!t.ok(response, 'Your program answered the listItems request with a FunctionCallResponse')) return;
        t.match(response.content, /milk[\s\S]*dentist[\s\S]*flight/i, 'listItems returns the three items the list starts with');
        sameId(t, call, response);
      },
    },
  ],
  live: {
    timeoutMs: 40000,
    script: [{ after: 'SettingsApplied', delay_ms: 500, send: { type: 'InjectUserMessage', content: 'Please delete buy milk from my to-do list.' } }],
    // Done once the delete has been answered and the agent has spoken after it.
    until: (s) => {
      const r = s.events.findIndex((e) => e.dir === 'client' && e.frame?.type === 'FunctionCallResponse' && e.frame.name === 'deleteItem');
      return r >= 0 && s.events.slice(r).some((e) => e.dir === 'server' && e.frame?.type === 'ConversationText' && e.frame.role === 'assistant');
    },
    grace_ms: 1000,
    assert(s, t) {
      functionsShape(s, t);
      for (const e of s.receivedOfType('Error')) t.fail(`The agent sent an error: ${e.description ?? e.message ?? ''} (${e.code ?? 'no code'})`);
      for (const w of s.receivedOfType('Warning')) {
        if (!REFUSED_FILLER.has(w.code)) continue;
        t.fail(w.code === 'INJECT_AGENT_MESSAGE_DURING_AGENT_SPEECH'
          ? `TODO 3: the agent refused your filler line (${w.code}). Send it with behavior "queue" so it waits its turn`
          : `TODO 3: the agent refused your filler line (${w.code}): the caller was still talking when it went out. Nothing to change if it goes out the moment the request arrives (TODO 3); run it again`);
      }
      const call = requestedCalls(s).find((c) => c.name === 'deleteItem');
      if (!t.ok(call, 'The agent asked your program to run deleteItem (FunctionCallRequest)')) return;
      const response = responseFor(s, 'deleteItem');
      if (!t.ok(response, 'Your program answered the deleteItem request with a FunctionCallResponse')) return;
      t.ok(typeof response.content === 'string' && response.content.trim() && response.content.trim() !== 'TODO', 'TODO 1: deleteItem returns what it did, not "TODO"');
      sameId(t, call, response);
      coveredTheWait(s, t, call, response);
      const spokeAfter = s.events.slice(response.index).some((e) => e.dir === 'server' && e.frame?.type === 'ConversationText' && e.frame.role === 'assistant');
      t.ok(spokeAfter, 'The agent spoke after your tool result came back');
    },
  },
};
