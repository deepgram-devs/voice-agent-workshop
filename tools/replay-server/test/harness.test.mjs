// Self-test for the harness, independent of either SDK: a bare `ws` client plays
// a good and a bad attendee against mission 00's replay.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket, WebSocketServer } from 'ws';
import {
  BAD_AGENT_URL, BAD_WORKSHOP_URL, liveTarget, upstreamUrl, validAddress, withoutHost, workshopUpstream,
} from '../lib/target.mjs';
import { Recorder } from '../lib/recorder.mjs';
import { Session } from '../lib/session.mjs';
import { oldShapeLines, settingsFunction } from '../lib/old-shape.mjs';
import { nodeSupported, nodeTooOld } from '../lib/node-version.mjs';

const HARNESS = new URL('../harness.mjs', import.meta.url).pathname;

function startHarness(args, env = process.env) {
  const proc = spawn(process.execPath, [HARNESS, ...args], { stdio: ['ignore', 'pipe', 'inherit'], env });
  const lines = [];
  const ready = new Promise((resolve) => {
    createInterface({ input: proc.stdout }).on('line', (l) => {
      lines.push(l);
      if (l.startsWith('READY ')) resolve(l.slice(6));
    });
  });
  const exit = new Promise((resolve) => proc.on('close', (code) => resolve(code)));
  const verdict = async () => {
    const code = await exit;
    const line = lines.findLast((l) => l.startsWith('VERDICT '));
    return { code, verdict: JSON.parse(line.slice(8)) };
  };
  return { ready, verdict, lines };
}

function client(url, onMessage) {
  const ws = new WebSocket(url);
  ws.on('message', (data, isBinary) => {
    if (!isBinary) onMessage(ws, JSON.parse(data.toString()));
  });
  return new Promise((resolve) => ws.on('close', resolve));
}

const GOOD = {
  type: 'Settings',
  audio: { input: { encoding: 'linear16', sample_rate: 16000 }, output: { encoding: 'linear16', sample_rate: 24000 } },
  agent: {
    listen: { provider: { type: 'deepgram', model: 'nova-3' } },
    think: { provider: { type: 'open_ai', model: 'gpt-4o-mini' }, prompt: 'You are a pirate who only talks about tea.' },
    speak: { provider: { type: 'deepgram', model: 'flux-cliff-en', version: 'v2' } },
    greeting: 'Ahoy.',
  },
};

test('list shows the replay scenarios', async () => {
  const { spawnSync } = await import('node:child_process');
  const out = spawnSync(process.execPath, [HARNESS, 'list', '00'], { encoding: 'utf8' });
  assert.equal(out.status, 0);
  assert.deepEqual(JSON.parse(out.stdout).replay, ['greeting']);
});

test('a correct client passes, and the greeting template is filled', async () => {
  const h = startHarness(['replay', '00', 'greeting']);
  const seen = [];
  await client(await h.ready, (ws, m) => {
    seen.push(m);
    if (m.type === 'Welcome') ws.send(JSON.stringify(GOOD));
  });
  const { code, verdict } = await h.verdict();
  assert.equal(code, 0, JSON.stringify(verdict.results, null, 1));
  assert.ok(seen.some((m) => m.type === 'ConversationText' && m.content === 'Ahoy.'));
});

test('a client that never sends Settings fails with a clear reason', async () => {
  const h = startHarness(['replay', '00', 'greeting']);
  await client(await h.ready, () => {});
  const { code, verdict } = await h.verdict();
  assert.equal(code, 1);
  assert.match(verdict.results[0].message, /never sent Settings/);
});

// ---- templates, audio clips, live scripts -----------------------------------

test('templates: a whole-string template keeps lists, a spliced one writes them as JSON', async () => {
  const { fillTemplates } = await import('../lib/fixture.mjs');
  const out = fillTemplates({ a: '{{settings.x}}', b: 'hints: {{settings.x}}', c: '{{settings.missing}}', d: 'n={{settings.n}}' }, { x: [], n: 3 });
  assert.deepEqual(out, { a: [], b: 'hints: []', c: '', d: 'n=3' });
});

test('every committed clip is mono linear16 at 16 kHz', async () => {
  const { readdirSync } = await import('node:fs');
  const { loadClip } = await import('../lib/audio.mjs');
  const clips = readdirSync(new URL('../../../fixtures/audio/', import.meta.url)).filter((f) => f.endsWith('.wav'));
  assert.ok(clips.length >= 5);
  for (const f of clips) {
    const clip = loadClip(`fixtures/audio/${f}`, 0);
    assert.equal(clip.sampleRate, 16000, f);
    assert.ok(clip.speechBytes > 16000, `${f} has at least half a second of audio`);
  }
});

test('parseWav rejects anything but mono 16-bit PCM', async () => {
  const { parseWav } = await import('../lib/audio.mjs');
  const wav = (channels, bits) => {
    const h = Buffer.alloc(44);
    h.write('RIFF', 0); h.writeUInt32LE(36, 4); h.write('WAVEfmt ', 8); h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22); h.writeUInt32LE(16000, 24); h.writeUInt16LE(bits, 34);
    h.write('data', 36); h.writeUInt32LE(0, 40);
    return h;
  };
  assert.equal(parseWav(wav(1, 16)).sampleRate, 16000);
  assert.throws(() => parseWav(wav(2, 16)), /mono 16-bit/);
  assert.throws(() => parseWav(wav(1, 8)), /mono 16-bit/);
  assert.throws(() => parseWav(Buffer.from('not a wav at all')), /not a WAV/);
});

test('live scripts: one of send or send_audio, nth from 1, clips must exist', async () => {
  const { prepareScript } = await import('../lib/script.mjs');
  const ok = prepareScript([{ after: 'AgentAudioDone', nth: 2, send: { type: 'KeepAlive' } }, { after: 'SettingsApplied', send_audio: 'fixtures/audio/04-spanish.wav' }], 'x');
  assert.equal(ok[0].nth, 2);
  assert.equal(ok[1].nth, 1);
  assert.ok(ok[1].clip.pcm.length > ok[1].clip.speechBytes, 'trailing silence is added');
  assert.throws(() => prepareScript([{ after: 'X', send: {}, send_audio: 'a.wav' }], 'x'), /exactly one/);
  assert.throws(() => prepareScript([{ after: 'X' }], 'x'), /exactly one/);
  assert.throws(() => prepareScript([{ after: 'X', nth: 0, send: {} }], 'x'), /nth/);
  assert.throws(() => prepareScript([{ after: 'X', send_audio: 'fixtures/audio/nope.wav' }], 'x'), /no audio file/);
});

test('streamClip sends every byte, at about real-time pace', async () => {
  const { streamClip } = await import('../lib/audio.mjs');
  const clip = { sampleRate: 16000, pcm: Buffer.alloc(6400) }; // 200 ms
  let bytes = 0;
  const started = Date.now();
  const done = await streamClip(clip, (c) => { bytes += c.length; }, () => true);
  assert.equal(done, true);
  assert.equal(bytes, 6400);
  assert.ok(Date.now() - started >= 150, 'not sent all at once');
  let stopped = 0;
  assert.equal(await streamClip({ sampleRate: 16000, pcm: Buffer.alloc(64000) }, (c) => { stopped += c.length; }, () => stopped < 1000), false);
});

test('live: an nth trigger waits for the nth frame of its type (mission 05 script)', async () => {
  const { WebSocketServer } = await import('ws');
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((r) => upstream.once('listening', r));
  const log = []; // { kind: 'inject' | 'done', at }
  upstream.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'Welcome', request_id: '0' }));
    let done = 0;
    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const m = JSON.parse(data.toString());
      if (m.type === 'Settings') ws.send(JSON.stringify({ type: 'SettingsApplied' }));
      if (m.type === 'InjectUserMessage') {
        log.push({ kind: 'inject', at: Date.now() });
        ws.send(JSON.stringify({ type: 'ConversationText', role: 'user', content: m.content }));
        ws.send(JSON.stringify({ type: 'ConversationText', role: 'assistant', content: 'Hmm.' }));
        // The answer "plays" for a while; a fixed-delay script would talk over it.
        setTimeout(() => {
          done += 1;
          log.push({ kind: 'done', at: Date.now(), n: done });
          ws.send(JSON.stringify({ type: 'AgentAudioDone' }));
        }, 1200);
      }
    });
  });
  const env = { ...process.env, DEEPGRAM_AGENT_URL: `ws://127.0.0.1:${upstream.address().port}` };
  const proc = spawn(process.execPath, [HARNESS, 'live', '05'], { stdio: ['ignore', 'pipe', 'inherit'], env });
  const url = await new Promise((resolve) => {
    createInterface({ input: proc.stdout }).on('line', (l) => l.startsWith('READY ') && resolve(l.slice(6)));
  });
  let users = 0;
  await client(url, (ws, m) => {
    if (m.type === 'Welcome') ws.send(JSON.stringify({ ...GOOD, agent: { ...GOOD.agent, greeting: undefined } }));
    if (m.type === 'ConversationText' && m.role === 'user' && ++users === 4) setTimeout(() => ws.close(1000), 100);
  });
  await new Promise((r) => proc.on('close', r));
  upstream.close();
  const injects = log.filter((e) => e.kind === 'inject');
  const dones = log.filter((e) => e.kind === 'done');
  assert.equal(injects.length, 4);
  for (let k = 1; k < 4; k++) assert.ok(injects[k].at >= dones[k - 1].at, `question ${k + 1} waited for answer ${k} to finish`);
});

// ---- live checks through the workshop proxy ----------------------------------

test('liveTarget: DEEPGRAM_AGENT_URL wins, then the workshop proxy (token and WORKSHOP_URL), then production', () => {
  const ws = { WORKSHOP_URL: 'https://speak.example.test/sdk/', WORKSHOP_TOKEN: 'wst_x' };
  assert.deepEqual(liveTarget({ ...ws }, '00-first-words'), { url: 'wss://speak.example.test/sdk/00-first-words/v1/agent/converse', workshop: true, label: 'workshop proxy' });
  assert.deepEqual(liveTarget({ ...ws, DEEPGRAM_API_KEY: 'k', DEEPGRAM_AGENT_URL: 'ws://127.0.0.1:9' }, '00-first-words'), { url: 'ws://127.0.0.1:9/v1/agent/converse', workshop: false, label: 'custom endpoint' });
  assert.equal(liveTarget({ DEEPGRAM_AGENT_URL: 'wss://agent.deepgram.com' }, '00-first-words').label, 'production');
  assert.equal(liveTarget({}, '00-first-words').label, 'production');
  // A key in the shell doesn't take over a workshop run: the token and WORKSHOP_URL win.
  assert.equal(liveTarget({ ...ws, DEEPGRAM_API_KEY: 'k' }, '00-first-words').workshop, true);
  assert.equal(liveTarget({ WORKSHOP_TOKEN: 'wst_x', DEEPGRAM_API_KEY: 'k' }, '00-first-words').label, 'production');
  assert.equal(liveTarget({ WORKSHOP_TOKEN: 'wst_x' }, '00-first-words').url, 'wss://agent.deepgram.com/v1/agent/converse');
  assert.equal(workshopUpstream('ws://localhost:8080/sdk/v1/agent/converse', '04-polyglot'), 'ws://localhost:8080/sdk/04-polyglot/v1/agent/converse');
});

test('liveTarget: a workshop token is never relayed to DEEPGRAM_AGENT_URL', () => {
  const env = { WORKSHOP_URL: 'https://speak.example.test/sdk/', WORKSHOP_TOKEN: 'wst_x', DEEPGRAM_AGENT_URL: 'wss://agent.hidden.example.test' };
  assert.throws(() => liveTarget(env, '00-first-words'), (err) => {
    assert.match(err.message, /^DEEPGRAM_AGENT_URL needs your own DEEPGRAM_API_KEY\./);
    assert.doesNotMatch(err.message, /hidden|wst_/);
    return true;
  });
});

test("liveTarget: an address that isn't one is the program's line (tools/parity/addresses.json)", () => {
  const table = JSON.parse(readFileSync(new URL('../../parity/addresses.json', import.meta.url), 'utf8'));
  assert.deepEqual(table.valid.filter((u) => !validAddress(u)), []);
  assert.deepEqual(table.invalid.filter((u) => validAddress(u)), []);
  for (const [raw, want] of table.agent) {
    if (want === null) assert.throws(() => upstreamUrl(raw), { message: BAD_AGENT_URL }, raw);
    else assert.equal(upstreamUrl(raw), `${want}/v1/agent/converse`, raw);
  }
  for (const [raw, want] of table.workshop) {
    if (want === null) assert.throws(() => workshopUpstream(raw, '00-first-words'), { message: BAD_WORKSHOP_URL }, raw);
    else assert.equal(workshopUpstream(raw, '00-first-words'), `${want}/00-first-words/v1/agent/converse`, raw);
  }
  const env = { DEEPGRAM_API_KEY: 'k', DEEPGRAM_AGENT_URL: 'ws://127.0.0.1:abc' };
  assert.throws(() => liveTarget(env, '00-first-words'), { message: BAD_AGENT_URL });
  assert.throws(() => liveTarget({ WORKSHOP_TOKEN: 'wst_x', WORKSHOP_URL: 'wss://a b/sdk' }, '00-first-words'), {
    message: BAD_WORKSHOP_URL,
  });
});

test('the live harness never prints the upstream host, in its banner or in an error line', async () => {
  assert.equal(withoutHost('getaddrinfo ENOTFOUND agent.hidden.example.test', 'wss://agent.hidden.example.test/v1/agent/converse', 'custom endpoint'), 'getaddrinfo ENOTFOUND custom endpoint');
  assert.equal(withoutHost('connect ECONNREFUSED 127.0.0.1:9', 'ws://127.0.0.1:9/v1/agent/converse', 'custom endpoint'), 'connect ECONNREFUSED custom endpoint');
  // An unresolvable host (.invalid never resolves), so the upstream errors and the error line is checked too.
  const env = { ...process.env, DEEPGRAM_AGENT_URL: 'wss://agent.hidden.invalid' };
  delete env.DEEPGRAM_API_KEY;
  delete env.WORKSHOP_TOKEN;
  const h = startHarness(['live', '00'], env);
  const ws = new WebSocket(await h.ready);
  ws.on('error', () => {});
  const { verdict } = await h.verdict();
  ws.terminate();
  const out = h.lines.join('\n');
  assert.match(out, /relaying to custom endpoint/);
  assert.match(out, /Could not reach custom endpoint/);
  assert.doesNotMatch(out, /hidden/);
  assert.ok(verdict);
});

test('a live check with only WORKSHOP_TOKEN relays to WORKSHOP_URL/<mission> and forwards the bearer token', async () => {
  // A fake workshop proxy: records where it was asked to go and with what.
  const proxy = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise((r) => proxy.once('listening', r));
  const seen = {};
  proxy.on('connection', (ws, req) => {
    seen.path = req.url;
    seen.auth = req.headers.authorization;
    ws.send(JSON.stringify({ type: 'Welcome', request_id: 'r' }));
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString());
      if (m.type === 'Settings') ws.send(JSON.stringify({ type: 'SettingsApplied' }));
      if (m.type === 'InjectUserMessage') ws.send(JSON.stringify({ type: 'ConversationText', role: 'assistant', content: 'Hi, I am Sam.' }));
    });
  });
  const env = { ...process.env, WORKSHOP_URL: `http://127.0.0.1:${proxy.address().port}/sdk`, WORKSHOP_TOKEN: 'wst_harness-test-token-0000000000000' };
  delete env.DEEPGRAM_API_KEY;
  delete env.DEEPGRAM_AGENT_URL;
  const h = startHarness(['live', '00'], env);
  const url = await h.ready;
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${env.WORKSHOP_TOKEN}` } });
  ws.on('message', (data, isBinary) => {
    if (!isBinary && JSON.parse(data.toString()).type === 'Welcome') ws.send(JSON.stringify({ ...GOOD, agent: { ...GOOD.agent, greeting: undefined } }));
  });
  const { code, verdict } = await h.verdict();
  ws.terminate();
  proxy.close();
  assert.equal(seen.path, '/sdk/00-first-words/v1/agent/converse');
  assert.equal(seen.auth, `Bearer ${env.WORKSHOP_TOKEN}`);
  assert.equal(code, 0, JSON.stringify(verdict.results));
});

for (const [type, code, said] of [
  ['Error', 'TALK_UNCONFIGURED', 'refused this session'],
  ['Warning', 'TALK_PAUSED', 'paused the agent during this check'],
]) {
  test(`a live check the workshop proxy stops with ${code} fails with the proxy's own line`, async () => {
    // A fake workshop proxy that refuses (an Error before Welcome) or pauses (a Warning after it).
    const description = 'Run your program again shortly.';
    const proxy = new WebSocketServer({ host: '127.0.0.1', port: 0 });
    await new Promise((r) => proxy.once('listening', r));
    proxy.on('connection', (ws) => {
      if (type === 'Error') {
        ws.send(JSON.stringify({ type: 'Error', code, description }));
        ws.close(1013, 'Try again later');
        return;
      }
      ws.send(JSON.stringify({ type: 'Welcome', request_id: 'r' }));
      ws.on('message', (d) => {
        if (JSON.parse(d.toString()).type !== 'Settings') return;
        ws.send(JSON.stringify({ type: 'SettingsApplied' }));
        ws.send(JSON.stringify({ type: 'Warning', code, description }));
        ws.close(1000, 'Paused by staff');
      });
    });
    const env = { ...process.env, WORKSHOP_URL: `ws://127.0.0.1:${proxy.address().port}/sdk`, WORKSHOP_TOKEN: 'wst_harness-test-token-0000000000000' };
    delete env.DEEPGRAM_API_KEY;
    delete env.DEEPGRAM_AGENT_URL;
    const h = startHarness(['live', '00'], env);
    const ws = new WebSocket(await h.ready, { headers: { Authorization: `Bearer ${env.WORKSHOP_TOKEN}` } });
    ws.on('error', () => {});
    ws.on('message', (data, isBinary) => {
      if (!isBinary && JSON.parse(data.toString()).type === 'Welcome') ws.send(JSON.stringify({ ...GOOD, agent: { ...GOOD.agent, greeting: undefined } }));
    });
    const { code: exit, verdict } = await h.verdict();
    ws.terminate();
    proxy.close();
    assert.equal(exit, 1);
    const out = h.lines.join('\n');
    assert.match(out, /00-first-words live\n/);
    assert.ok(out.includes(`FAIL  The workshop proxy ${said}: ${description} (${code})`), out);
    assert.equal(verdict.pass, false);
    // The proxy's line is the whole report: no follow-on FAIL lines for the same cause.
    assert.equal(verdict.results.length, 1, out);
  });
}

test('a live check with a scheme-less DEEPGRAM_AGENT_URL names the variable and never the host', async () => {
  assert.throws(() => liveTarget({ DEEPGRAM_AGENT_URL: 'agent.hidden.example.test' }, '00-first-words'), (err) => /^DEEPGRAM_AGENT_URL must be a wss:\/\/ URL/.test(err.message) && !/hidden/.test(err.message));
  assert.throws(() => liveTarget({ WORKSHOP_URL: 'speak.hidden.example.test/sdk', WORKSHOP_TOKEN: 'wst_x' }, '00-first-words'), (err) => /^WORKSHOP_URL must be a wss:\/\/ URL/.test(err.message) && !/hidden/.test(err.message));
  const env = { ...process.env, DEEPGRAM_AGENT_URL: 'agent.hidden.example.test' };
  delete env.DEEPGRAM_API_KEY;
  const h = startHarness(['live', '00'], env);
  const { code, verdict } = await h.verdict();
  assert.equal(code, 2);
  assert.match(verdict.error, /DEEPGRAM_AGENT_URL must be a wss:\/\/ URL/);
  assert.doesNotMatch(h.lines.join('\n') + JSON.stringify(verdict), /hidden/);
});

test('the recorder writes frame types for your program, server frames as they came, and no host or header', () => {
  const session = new Session();
  session.addJson('client', { type: 'Settings', agent: { think: { prompt: 'SECRET PROMPT TEXT' } } });
  session.addJson('server', { type: 'Welcome', request_id: 'r' });
  session.addBinary('client', 640);
  session.addJson('client', { type: 'KeepAlive' });
  session.addBinary('server', 100);
  session.addBinary('server', 200);
  session.addJson('server', { type: 'ConversationText', role: 'assistant', content: 'Hi.' });
  session.close = { by: 'server', code: 1000, reason: 'done' };
  const lines = new Recorder(session).lines({ mission: '00-first-words' });
  const text = JSON.stringify(lines);
  assert.equal(lines[0].meta.mission, '00-first-words');
  assert.match(lines[0].meta.recorded_at, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(Object.keys(lines[0].meta).sort(), ['mission', 'recorded_at']);
  assert.deepEqual(lines.slice(1), [
    { expect: 'Settings' },
    { recv: { type: 'Welcome', request_id: 'r' } },
    { recv_binary: { bytes: 300 } },
    { recv: { type: 'ConversationText', role: 'assistant', content: 'Hi.' } },
    { close: { code: 1000, reason: 'done' } },
  ]);
  assert.doesNotMatch(text, /SECRET PROMPT TEXT|authorization|wss?:\/\//i);
});

// ---- field names from earlier API versions ----------------------------------

/** A Session holding these client and server frames, in order. */
function sessionOf(client = [], server = []) {
  const s = new Session();
  for (const f of server) s.addJson('server', f);
  for (const f of client) s.addJson('client', f);
  return s;
}

test('old shape: 2024 Settings fields each get one line naming the current field', () => {
  const old = {
    type: 'Settings',
    audio: GOOD.audio,
    agent: {
      listen: { model: 'nova-2' },
      think: { provider: { type: 'open_ai' }, model: 'gpt-4o-mini', instructions: 'You are a pirate.', functions: [{ name: 'f', url: 'https://x.test' }] },
      speak: { model: 'aura-asteria-en' },
    },
  };
  const lines = oldShapeLines(sessionOf([old]));
  assert.deepEqual(lines, [
    'agent.listen.model is the old shape: use agent.listen.provider.model (provider type "deepgram")',
    'agent.think.instructions is the old shape: use agent.think.prompt',
    'agent.think.model is the old shape: use agent.think.provider.model',
    "agent.think.functions[].url, method and headers are the old shape: put them in the function's endpoint ({ url, method, headers })",
    'agent.speak.model is the old shape: use agent.speak.provider.model (provider type "deepgram")',
  ]);
  assert.deepEqual(oldShapeLines(sessionOf([GOOD])), [], 'current Settings get no lines');
});

test('old shape: a voice and a version that do not go together', () => {
  const withVoice = (provider) => ({ ...GOOD, agent: { ...GOOD.agent, speak: { provider: { type: 'deepgram', ...provider } } } });
  assert.match(oldShapeLines(sessionOf([withVoice({ model: 'aura-2-thalia-en', version: 'v2' })]))[0], /Aura voice, so leave version out/);
  // The line names where the version sits, by the start file's language (harness.mjs passes --source's).
  assert.match(oldShapeLines(sessionOf([withVoice({ model: 'aura-2-thalia-en', version: 'v2' })]), '', settingsFunction('python/missions/00-first-words/start.py')).at(-1), /\(the speak provider line in build_settings\(\)\)$/);
  assert.match(oldShapeLines(sessionOf([withVoice({ model: 'flux-cliff-en', version: 'v1' })]), '', settingsFunction('typescript/missions/00-first-words/start.ts')).at(-1), /\(the speak provider line in buildSettings\(\)\)$/);
  assert.equal(settingsFunction('java/missions/m00_first_words/Start.java'), 'buildSettings()');
  assert.match(oldShapeLines(sessionOf([withVoice({ model: 'flux-cliff-en' })]))[0], /Flux voice, so set version "v2"/);
  assert.deepEqual(oldShapeLines(sessionOf([withVoice({ model: 'aura-2-thalia-en' })])), []);
  assert.deepEqual(oldShapeLines(sessionOf([withVoice({ model: 'flux-cliff-en', version: 'v2' })])), []);
});

test('old shape: FunctionCallRequest fields read from your code, and old messages sent', () => {
  const request = { type: 'FunctionCallRequest', functions: [{ id: 'fc_1', name: 'end_call', arguments: '{}', client_side: true }] };
  const unanswered = oldShapeLines(sessionOf([GOOD, { type: 'FunctionCallResponse', content: 'ok' }], [request]));
  assert.match(unanswered[0], /^Your FunctionCallResponse has no id or name/);
  const oldResponse = oldShapeLines(sessionOf([GOOD, { type: 'FunctionCallResponse', function_call_id: 'fc_1', output: 'ok' }], [request]));
  assert.match(oldResponse[0], /^FunctionCallResponse with function_call_id and output is the old shape/);
  const source = "if event.get('function_name') == 'end_call':\n    await agent.function_call_response(event['function_call_id'], 'end_call', 'ok')\n";
  assert.match(oldShapeLines(sessionOf([GOOD]), source)[0], /^function_name and function_call_id are the old FunctionCallRequest fields/);
  assert.deepEqual(oldShapeLines(sessionOf([GOOD]), '# function_name is gone: read event["functions"]\n'), [], 'a comment is not code');
  assert.match(oldShapeLines(sessionOf([GOOD, { type: 'UpdateInstructions', instructions: 'x' }]))[0], /^UpdateInstructions is the old message/);
});

test('a replay with 2024 Settings leads with the old-shape lines', async () => {
  const h = startHarness(['replay', '00', 'greeting']);
  const old = { ...GOOD, agent: { ...GOOD.agent, think: { provider: { type: 'open_ai', model: 'gpt-4o-mini' }, instructions: 'You are a pirate who only talks about tea.' }, speak: { model: 'aura-asteria-en' } } };
  await client(await h.ready, (ws, m) => {
    if (m.type === 'Welcome') ws.send(JSON.stringify(old));
  });
  const { code, verdict } = await h.verdict();
  assert.equal(code, 1);
  assert.equal(verdict.results[0].message, 'agent.think.instructions is the old shape: use agent.think.prompt');
  assert.match(verdict.results[1].message, /^agent\.speak\.model is the old shape/);
});

test('workshopUpstream: a WORKSHOP_URL without /sdk says so', () => {
  assert.equal(workshopUpstream('https://speak.example.test/sdk/', '00-first-words'), 'wss://speak.example.test/sdk/00-first-words/v1/agent/converse');
  assert.throws(() => workshopUpstream('https://speak.example.test', '00-first-words'), /^Error: WORKSHOP_URL should end in \/sdk\./);
});

test('a replay with SettingsConfiguration prints every old field at once, then one rename line', async () => {
  const h = startHarness(['replay', '00', 'greeting']);
  const old = {
    type: 'SettingsConfiguration',
    audio: GOOD.audio,
    agent: { listen: { model: 'nova-2' }, think: { provider: { type: 'open_ai' }, model: 'gpt-4o-mini', instructions: 'You are a pirate.' }, speak: { model: 'aura-asteria-en' } },
  };
  const started = Date.now();
  await client(await h.ready, (ws, m) => {
    if (m.type === 'Welcome') ws.send(JSON.stringify(old));
  });
  const { code, verdict } = await h.verdict();
  assert.equal(code, 1);
  const failed = verdict.results.filter((r) => !r.pass).map((r) => r.message);
  assert.deepEqual(failed, [
    'agent.listen.model is the old shape: use agent.listen.provider.model (provider type "deepgram")',
    'agent.think.instructions is the old shape: use agent.think.prompt',
    'agent.think.model is the old shape: use agent.think.provider.model',
    'agent.speak.model is the old shape: use agent.speak.provider.model (provider type "deepgram")',
    'SettingsConfiguration is the old message name: the message is Settings, and run() sets its type for you',
    'Rename the fields above, then run make check again: the mission checks read the current names.',
  ]);
  assert.ok(Date.now() - started < 4000, 'no wait for a Settings that never comes');
});

test('an Aura voice with version "v2" is not a rename: the mission\'s own failing check stays, with no Rename line', async () => {
  // The starter prompt fails exactly one mission 00 check (TODO 1: the prompt is your own); the
  // rest of GOOD passes. The Aura line leads, that check follows, and nothing is swallowed.
  const h = startHarness(['replay', '00', 'greeting']);
  const aura = {
    ...GOOD,
    agent: {
      ...GOOD.agent,
      think: { ...GOOD.agent.think, prompt: 'You are a helpful assistant.' },
      speak: { provider: { type: 'deepgram', model: 'aura-2-thalia-en', version: 'v2' } },
    },
  };
  await client(await h.ready, (ws, m) => {
    if (m.type === 'Welcome') ws.send(JSON.stringify(aura));
  });
  const { code, verdict } = await h.verdict();
  assert.equal(code, 1);
  const failed = verdict.results.filter((r) => !r.pass).map((r) => r.message);
  assert.deepEqual(failed, [
    'agent.speak.provider: aura-2-thalia-en is an Aura voice, so leave version out (or set "v1"); version "v2" is for flux-* voices (the speak provider line in build_settings() / buildSettings())',
    'TODO 1: the prompt is your own, not the starter one',
  ]);
  assert.ok(verdict.results.filter((r) => r.pass).length >= 8, 'the checks that pass still print');
});

test('old shape: writing function_call_id into a response is not a read of the old request fields', () => {
  const ts = "agent.sendRaw({ type: 'FunctionCallResponse', function_call_id: fn.id, output: 'ok' });\nfor (const fn of event.functions) {}\n";
  assert.deepEqual(oldShapeLines(sessionOf([GOOD]), ts), []);
  assert.match(oldShapeLines(sessionOf([GOOD]), 'if (event.function_name === "end_call") {}')[0], /^function_name and function_call_id/);
  const request = { type: 'FunctionCallRequest', functions: [{ id: 'fc_1', name: 'end_call', arguments: '{}', client_side: true }] };
  const lines = oldShapeLines(sessionOf([GOOD, { type: 'FunctionCallResponse', function_call_id: 'fc_1', output: 'ok' }], [request]), "x = event['function_call_id']");
  assert.equal(lines.length, 1, 'the response line covers it');
});

test('Node.js range: ^20.19.0 || >=22.12.0, as package.json engines says', () => {
  for (const v of ['20.19.0', '20.20.1', '22.12.0', '22.20.0', '23.0.0', '24.1.0', '26.5.0']) assert.ok(nodeSupported(v), v);
  for (const v of ['12.22.9', '18.19.1', '20.18.3', '21.7.3', '22.11.0']) assert.ok(!nodeSupported(v), v);
});

test('on a Node.js older than that, the harness stops with one line and exit 2', async () => {
  // Node 18.19.1 as Ubuntu 24.04 and Debian 12 ship it, faked before the harness loads.
  const fake = "Object.defineProperty(process,'versions',{value:{...process.versions,node:'18.19.1'}});Object.defineProperty(process,'version',{value:'v18.19.1'});";
  const child = spawn(process.execPath, ['--import', `data:text/javascript,${encodeURIComponent(fake)}`, HARNESS, 'list', '00'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  const code = await new Promise((done) => child.on('close', done));
  assert.equal(code, 2);
  assert.equal(out.trim(), nodeTooOld('v18.19.1'));
});
