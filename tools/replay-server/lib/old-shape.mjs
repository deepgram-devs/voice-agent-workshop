// Field names from earlier versions of the Voice Agent API (2024, SDK v3 era) and the
// current names that replaced them. A program written from an old snippet still runs,
// but the mission checks would name the wrong problem ("the prompt is your own", say),
// so each old name gets one line of its own, first in the report.
//
// Current names come from the pinned SDK types: @deepgram/sdk 5.14.0 (ThinkSettingsV1,
// SpeakSettingsV1, AgentV1FunctionCallRequest, AgentV1SendFunctionCallResponse) and
// deepgram-sdk 7.12.0 (the same models in Python).

const asList = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []);
const has = (obj, key) => obj !== null && typeof obj === 'object' && Object.hasOwn(obj, key) && obj[key] !== undefined;

/** Lines about the Settings message: old field names, and a voice whose version doesn't fit it. */
function settingsLines(settings, where) {
  return [...renameLines(settings), ...versionLines(settings, where)];
}

/** The old field names in Settings: each is a rename, and the mission checks would read the wrong field. */
function renameLines(settings) {
  const lines = [];
  const agent = settings?.agent; // Settings, or the 2024 SettingsConfiguration
  if (!agent || typeof agent !== 'object') return lines;
  if (has(agent.listen, 'model')) {
    lines.push('agent.listen.model is the old shape: use agent.listen.provider.model (provider type "deepgram")');
  }
  for (const think of asList(agent.think)) {
    if (has(think, 'instructions')) lines.push('agent.think.instructions is the old shape: use agent.think.prompt');
    if (has(think, 'model')) lines.push('agent.think.model is the old shape: use agent.think.provider.model');
    for (const fn of asList(think.functions)) {
      if (['url', 'method', 'headers'].some((k) => has(fn, k))) {
        lines.push('agent.think.functions[].url, method and headers are the old shape: put them in the function\'s endpoint ({ url, method, headers })');
        break;
      }
    }
  }
  for (const speak of asList(agent.speak)) {
    if (has(speak, 'model')) lines.push('agent.speak.model is the old shape: use agent.speak.provider.model (provider type "deepgram")');
  }
  return lines;
}

/** A voice whose version doesn't fit it (Aura with "v2", Flux without it): not a rename, the field names are current. */
function versionLines(settings, where) {
  const lines = [];
  const agent = settings?.agent;
  if (!agent || typeof agent !== 'object') return lines;
  for (const speak of asList(agent.speak)) {
    const p = speak?.provider;
    if (p?.type === 'deepgram' && typeof p.model === 'string') {
      const version = p.version ?? 'v1'; // the API's default when version is left out
      if (p.model.startsWith('aura-') && version !== 'v1') {
        lines.push(`agent.speak.provider: ${p.model} is an Aura voice, so leave version out (or set "v1"); version "v2" is for flux-* voices (the speak provider line in ${where})`);
      } else if (p.model.startsWith('flux-') && version !== 'v2') {
        lines.push(`agent.speak.provider: ${p.model} is a Flux voice, so set version "v2"; "v1" (the default) is for aura-* voices (the speak provider line in ${where})`);
      }
    }
  }
  return lines;
}

/** Lines about other messages your program sent in an old shape. */
function messageLines(session) {
  const lines = [];
  const sent = session.sent;
  if (sent.some((f) => f.type === 'SettingsConfiguration')) {
    lines.push('SettingsConfiguration is the old message name: the message is Settings, and run() sets its type for you');
  }
  if (sent.some((f) => f.type === 'UpdateInstructions')) {
    lines.push('UpdateInstructions is the old message: send UpdatePrompt with agent.update_prompt(text) [agent.updatePrompt(text)]');
  }
  const responses = sent.filter((f) => f.type === 'FunctionCallResponse');
  if (responses.some((f) => has(f, 'function_call_id') || has(f, 'output'))) {
    lines.push('FunctionCallResponse with function_call_id and output is the old shape: it carries id, name and content, which agent.function_call_response(id, name, content) [agent.functionCallResponse] sends');
  } else if (session.receivedOfType('FunctionCallRequest').length && responses.some((f) => f.id == null || f.name == null)) {
    lines.push('Your FunctionCallResponse has no id or name: take both from the request. FunctionCallRequest carries a functions list, and each item has id, name and arguments');
  }
  return lines;
}

/** Lines about the old FunctionCallRequest fields, read in your source file. */
function sourceLines(source) {
  if (!source) return [];
  // Comments may name the old fields (a note to yourself); only code counts.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)(#|\/\/).*$/gm, '$1');
  // Only reads of a request's fields: event.function_name, event["function_call_id"],
  // event.get("function_name"). Writing function_call_id into a response is a different line.
  if (/\.function_(name|call_id)\b|\[\s*['"]function_(name|call_id)['"]\s*\]|\.get\(\s*['"]function_(name|call_id)['"]/.test(code)) {
    return ['function_name and function_call_id are the old FunctionCallRequest fields: read event["functions"] [event.functions], a list whose items have id, name and arguments'];
  }
  return [];
}

/** Every old-shape line for this run, in report order, without repeats. */
/** The function a start file builds its Settings in, by the source file's language. */
export function settingsFunction(sourcePath = '') {
  return String(sourcePath).endsWith('.py') ? 'build_settings()' : 'buildSettings()';
}

export function oldShapeLines(session, source = '', where = 'build_settings() / buildSettings()') {
  const settings = session.settings ?? session.sent.find((f) => f.type === 'SettingsConfiguration') ?? null;
  const messages = messageLines(session);
  // An old FunctionCallResponse already names function_call_id; the source line would repeat it.
  const oldResponse = messages.some((l) => l.startsWith('FunctionCallResponse with function_call_id'));
  return [...new Set([...settingsLines(settings, where), ...messages, ...(oldResponse ? [] : sourceLines(source))])];
}

/**
 * The lines in oldShapeLines() that are renames (an old field or message name, or an old
 * request field read in the source): after one of these the mission's checks read the wrong
 * fields. A version line (Aura with "v2", Flux without it) is not one: the checks still read
 * agent.speak.provider correctly, so they stay.
 */
export function renameShapeLines(session, source = '') {
  const settings = session.settings ?? session.sent.find((f) => f.type === 'SettingsConfiguration') ?? null;
  const messages = messageLines(session);
  const oldResponse = messages.some((l) => l.startsWith('FunctionCallResponse with function_call_id'));
  return [...new Set([...renameLines(settings), ...messages, ...(oldResponse ? [] : sourceLines(source))])];
}
