#!/usr/bin/env node
// The mission check harness. Your program connects to it instead of Deepgram.
//
//   node harness.mjs list   <mission>                    scenarios as JSON
//   node harness.mjs replay <mission> <scenario>         offline: replay a fixture, assert, exit
//   node harness.mjs live   <mission> [--record <file>]  relay to the real API, assert, exit
//
// Options: --port <n> (default: any free port), --connect-timeout <ms>, --dump <file> (session JSON),
// --source <file> (your start file: read for old API field names, see lib/old-shape.mjs).
// Prints "READY <ws url>" once listening and "VERDICT <json>" as the last line.
// Exit codes: 0 pass, 1 fail, 2 the harness itself could not run.
//
// Live mode reads DEEPGRAM_AGENT_URL for the upstream. With WORKSHOP_TOKEN and
// WORKSHOP_URL set (or a WORKSHOP_TOKEN and no DEEPGRAM_API_KEY), it relays to the
// workshop proxy instead (WORKSHOP_URL/<mission>/v1/agent/converse), the same place
// and the same credential your program uses on its own. DEEPGRAM_AGENT_URL still wins
// when set, but only with your own DEEPGRAM_API_KEY: a workshop token is never relayed
// there. It only checks whether
// those variables are set, never reads or prints their values: your program's
// Authorization header is forwarded as is.
// A live check's `script` plays the caller: each step fires on the nth server
// frame of a type and sends a JSON frame (`send`) or streams a WAV clip
// (`send_audio`). See lib/script.mjs and CONTRIBUTING.md.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { WebSocketServer, WebSocket } from 'ws';
import { createAsserts } from './lib/assert.mjs';
import { streamClip } from './lib/audio.mjs';
import { prepareScript } from './lib/script.mjs';
import { loadFixture, runFixture } from './lib/fixture.mjs';
import { nodeSupported, nodeTooOld } from './lib/node-version.mjs';
import { fixturePath, loadCheck, resolveMission } from './lib/missions.mjs';
import { oldShapeLines, renameShapeLines, settingsFunction } from './lib/old-shape.mjs';
import { Recorder } from './lib/recorder.mjs';
import { Session, get } from './lib/session.mjs';
import { liveTarget, withoutHost } from './lib/target.mjs';

function parseArgs(argv) {
  const positional = [];
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) opts[a.slice(2)] = argv[i + 1]?.startsWith('--') || argv[i + 1] === undefined ? true : argv[++i];
    else positional.push(a);
  }
  return { positional, opts };
}


function listen(port) {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: Number(port) || 0 });
    wss.once('listening', () => resolve(wss));
    wss.once('error', reject);
  });
}

/** Accept exactly one client. Later connections are turned away. */
function firstClient(wss, ms) {
  return new Promise((resolve) => {
    let taken = false;
    const timer = setTimeout(() => resolve(null), ms);
    wss.on('connection', (ws, req) => {
      if (taken) {
        ws.close(1013, 'one connection per check');
        return;
      }
      taken = true;
      clearTimeout(timer);
      resolve({ ws, req });
    });
  });
}

/** Record every client frame, and let fixture steps wait for one by type. */
function trackClient(ws, session, onFrame) {
  let cursor = 0;
  const waiters = new Set();
  const wake = () => waiters.forEach((w) => w());
  ws.on('message', (data, isBinary) => {
    if (isBinary) session.addBinary('client', data.length);
    else {
      try {
        session.addJson('client', JSON.parse(data.toString()));
      } catch {
        session.problems.push('Your program sent a text frame that is not JSON.');
      }
    }
    onFrame?.(data, isBinary);
    wake();
  });
  ws.on('close', (code, reason) => {
    session.close ??= { by: 'client', code, reason: reason.toString(), at: session.now() };
    wake();
  });
  const waitForClient = (type, ms) =>
    new Promise((resolve) => {
      const check = () => {
        if (type === 'close') return session.close ? (done(true), true) : false;
        const events = session.events;
        for (; cursor < events.length; cursor++) {
          const e = events[cursor];
          // The 2024 name for Settings counts as Settings, so its field lines all print at once
          // (lib/old-shape.mjs) instead of after a wait for a Settings that never comes.
          if (e.dir === 'client' && (e.frame?.type === type || (type === 'Settings' && e.frame?.type === 'SettingsConfiguration'))) {
            cursor++;
            done(true);
            return true;
          }
        }
        if (session.close) return done(false), true;
        return false;
      };
      const timer = setTimeout(() => done(false), ms);
      function done(v) {
        clearTimeout(timer);
        waiters.delete(check);
        resolve(v);
      }
      if (!check()) waiters.add(check);
    });
  return { waitForClient };
}

function waitForClose(ws, ms) {
  if (ws.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    ws.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

// Codes the workshop proxy refuses a session with (one Error before Welcome, then close
// 1013), and the Warning a staff pause ends a session with. Their description says what to do.
const REFUSAL_CODES = new Set(['TALK_UNCONFIGURED', 'TALK_PAUSED', 'ONLINE_FULL', 'LIVE_CLOSED']);

/** One problem line when the workshop proxy refused or paused this session, else null. */
function workshopStop(session) {
  const stop = [...session.receivedOfType('Error'), ...session.receivedOfType('Warning')].find((f) => REFUSAL_CODES.has(f.code));
  if (!stop) return null;
  const what = stop.type === 'Error' ? 'refused this session' : 'paused the agent during this check';
  return `The workshop proxy ${what}: ${stop.description ?? ''} (${stop.code})`.replace(':  (', ': (');
}

/** Your start file's text, for old field names (--source), or '' when there is none. */
function sourceText(opts) {
  try {
    return typeof opts.source === 'string' && existsSync(opts.source) ? readFileSync(opts.source, 'utf8') : '';
  } catch {
    return '';
  }
}

async function verdict(session, assertFn, opts, label, { stopped = null } = {}) {
  const t = createAsserts();
  if (stopped) {
    // The workshop refused or paused this session: that line is the whole story, and
    // the checks after it would only fail for the same reason.
    t.fail(stopped);
    return report(t, session, opts, label, { stopped: true });
  }
  // A field name from an earlier API version: one line each, before the checks it would mislead.
  const source = sourceText(opts);
  const old = oldShapeLines(session, source, opts.source ? settingsFunction(opts.source) : undefined);
  for (const line of old) t.fail(line);
  // Only a rename hides the checks below. A version mismatch (Aura with "v2", Flux without it)
  // is not a rename: the mission's checks still read the right fields, so they stay.
  const renames = renameShapeLines(session, source);
  if (session.stalled) {
    t.fail(`Your program never sent ${session.stalled.waitingFor} (${session.stalled.reason}).`, session.stalled);
  }
  for (const p of session.problems) t.fail(p);
  const before = t.results.length;
  try {
    await assertFn(session, t);
  } catch (err) {
    t.fail(`The check itself crashed: ${err.message}`);
  }
  if (renames.length) {
    // The mission's checks read the current field names, so after an old-shape line their
    // failures (a TODO that is already right, say) would only mislead: keep the passes, and
    // say once what to do instead.
    const checks = t.results.splice(before);
    t.results.push(...checks.filter((r) => r.pass));
    if (checks.some((r) => !r.pass)) t.fail('Rename the fields above, then run make check again: the mission checks read the current names.');
  }
  if (t.results.length === 0) t.fail('The check made no assertions.');
  return report(t, session, opts, label);
}

/** Print the results and the VERDICT line. `stopped`: the session never ran (nothing in your file to change). */
function report(t, session, opts, label, { stopped = false } = {}) {
  const pass = t.results.every((r) => r.pass);
  console.log(`\n${label}`);
  for (const r of t.results) console.log(`  ${r.pass ? 'PASS' : 'FAIL'}  ${r.message}`);
  if (opts.dump) writeFileSync(opts.dump, JSON.stringify(session, null, 2));
  console.log(`VERDICT ${JSON.stringify({ pass, results: t.results, ...(stopped ? { stopped } : {}) })}`);
  return pass;
}

async function runReplay(missionDir, scenarioName, opts) {
  const { replay } = await loadCheck(missionDir);
  const scenario = replay.find((s) => s.name === scenarioName) ?? (scenarioName ? null : replay[0]);
  if (!scenario) throw new Error(`missions/${missionDir}/check.mjs has no replay scenario "${scenarioName}". Have: ${replay.map((s) => s.name).join(', ')}`);
  const steps = loadFixture(fixturePath(missionDir, scenario.fixture));

  const wss = await listen(opts.port);
  console.log(`READY ws://127.0.0.1:${wss.address().port}`);
  const session = new Session();
  const conn = await firstClient(wss, Number(opts['connect-timeout'] ?? 30000));
  if (!conn) {
    session.problems.push('Your program never connected. Is DEEPGRAM_AGENT_URL pointing at the harness?');
  } else {
    const { ws } = conn;
    const { waitForClient } = trackClient(ws, session);
    const io = {
      sendJson: (f) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        session.addJson('server', f);
        ws.send(JSON.stringify(f));
      },
      sendBinary: (b) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        session.addBinary('server', b.length);
        ws.send(b, { binary: true });
      },
      close: (code, reason) => {
        session.close ??= { by: 'server', code, reason, at: session.now() };
        ws.close(code, reason);
      },
      waitForClient,
    };
    await runFixture(steps, session, io);
    if (!session.close) {
      // End of fixture: give the client a moment to send its last frames, then hang up.
      await new Promise((r) => setTimeout(r, Number(opts.grace ?? 300)));
      io.close(1000, 'replay finished');
    }
    await waitForClose(ws, 2000);
  }
  wss.close();
  return verdict(session, scenario.assert, opts, `${missionDir} replay "${scenario.name}"`);
}

async function runLive(missionDir, opts) {
  const { live } = await loadCheck(missionDir);
  if (!live || typeof live.assert !== 'function') throw new Error(`missions/${missionDir}/check.mjs has no live check`);
  const scriptState = prepareScript(live.script, missionDir);
  const { url: target, workshop, label } = liveTarget(process.env, missionDir);
  const timeoutMs = Number(live.timeoutMs ?? 30000);

  const wss = await listen(opts.port);
  console.log(`READY ws://127.0.0.1:${wss.address().port}`);
  console.log(`relaying to ${label}`);
  const session = new Session();
  const recorder = opts.record ? new Recorder(session) : null;
  const conn = await firstClient(wss, Number(opts['connect-timeout'] ?? 30000));
  if (!conn) {
    session.problems.push('Your program never connected. Is DEEPGRAM_AGENT_URL pointing at the harness?');
    wss.close();
    return verdict(session, live.assert, opts, `${missionDir} live`);
  }
  const { ws, req } = conn;
  const headers = {};
  if (req.headers.authorization) headers.Authorization = req.headers.authorization;
  const protocols = req.headers['sec-websocket-protocol']?.split(',').map((p) => p.trim()).filter(Boolean);
  let up;
  try {
    up = new WebSocket(target, protocols?.length ? protocols : undefined, { headers });
  } catch (err) {
    // ws puts the URL in some of its messages; withoutHost takes the host back out.
    ws.close(1000, 'upstream error');
    wss.close();
    throw new Error(`Could not open ${label}: ${withoutHost(err.message, target, label)}`);
  }
  const queued = [];
  let finished = false;
  // Set when the upstream refused or was unreachable: that one line stands in for every check.
  let upstreamProblem = null;

  const finish = (code, reason, by = 'harness') => {
    if (finished) return;
    finished = true;
    session.close ??= { by, code, reason, at: session.now() };
    const safe = code === 1000 || (code >= 3000 && code < 5000) ? code : 1000;
    if (ws.readyState === WebSocket.OPEN) ws.close(safe, reason.slice(0, 120));
    if (up.readyState === WebSocket.OPEN || up.readyState === WebSocket.CONNECTING) up.close(1000);
  };

  // How many frames of each type the server has sent, for `nth` triggers.
  const seen = new Map();
  // Clips play one after another, never on top of each other.
  let audioChain = Promise.resolve();
  const upOpen = () => !finished && up.readyState === WebSocket.OPEN;
  const playClip = (step) => {
    audioChain = audioChain.then(async () => {
      if (!upOpen()) return;
      const enc = get(session.settings, 'audio.input.encoding');
      const rate = Number(get(session.settings, 'audio.input.sample_rate'));
      if (enc !== 'linear16' || rate !== step.clip.sampleRate) {
        session.problems.push(
          `The live check plays ${step.clip.path} as linear16 at ${step.clip.sampleRate} Hz, but your Settings asks for ${enc ?? 'no encoding'} at ${rate || 'no'} Hz. Keep audio.input at linear16, ${step.clip.sampleRate} Hz.`,
        );
        return;
      }
      session.events.push({ dir: 'harness', at: session.now(), audio: step.clip.path, bytes: step.clip.pcm.length });
      await streamClip(step.clip, (chunk) => up.send(chunk, { binary: true }), upOpen);
    });
  };
  trackClient(ws, session, (data, isBinary) => {
    if (up.readyState === WebSocket.OPEN) up.send(data, { binary: isBinary });
    else queued.push([data, isBinary]);
  });
  ws.on('close', () => finish(1000, 'client closed', 'client'));

  up.on('open', () => {
    for (const [d, b] of queued.splice(0)) up.send(d, { binary: b });
  });
  up.on('unexpected-response', (_req, res) => {
    let hint = '';
    if (res.statusCode === 401) hint = workshop ? "Check WORKSHOP_TOKEN: it expired, was replaced, or was turned off by workshop staff. Get a new one on the workshop site's /code page." : 'Check DEEPGRAM_API_KEY.';
    // 404 through the proxy: the token route is gone, which is what every token gets after the event.
    else if (res.statusCode === 404 && workshop) hint = 'The workshop proxy is closed: it runs on event day only. Put your own DEEPGRAM_API_KEY in .env and leave WORKSHOP_TOKEN empty; missions 01 and 02 (`timing`) pass offline with make check, or on a Deepgram project that has the `timing` feature.';
    upstreamProblem = `${workshop ? 'The workshop proxy' : 'Deepgram'} refused the connection: HTTP ${res.statusCode}. ${hint}`.trim();
    finish(1000, `upstream HTTP ${res.statusCode}`);
  });
  up.on('error', (err) => {
    if (!finished) upstreamProblem ??= `Could not reach ${label}: ${withoutHost(err.message, target, label)}`;
    finish(1000, 'upstream error');
  });
  up.on('close', (code, reason) => finish(code, reason.toString() || 'upstream closed', 'server'));
  up.on('message', (data, isBinary) => {
    let frame = null;
    if (isBinary) session.addBinary('server', data.length);
    else {
      try {
        frame = JSON.parse(data.toString());
        session.addJson('server', frame);
      } catch {
        session.problems.push('Deepgram sent a text frame that is not JSON.');
      }
    }
    if (ws.readyState === WebSocket.OPEN) ws.send(data, { binary: isBinary });
    if (!frame) return;
    if (frame.type) seen.set(frame.type, (seen.get(frame.type) ?? 0) + 1);
    for (const s of scriptState) {
      if (!s.fired && frame.type === s.after && seen.get(s.after) === s.nth) {
        s.fired = true;
        setTimeout(() => {
          if (!upOpen()) return;
          if (s.clip) return playClip(s);
          session.events.push({ dir: 'harness', at: session.now(), frame: s.send });
          up.send(JSON.stringify(s.send));
        }, Number(s.delay_ms ?? 0));
      }
    }
    if (typeof live.until === 'function' && live.until(session)) {
      setTimeout(() => finish(1000, 'check complete'), Number(live.grace_ms ?? 500));
    }
  });

  const timer = setTimeout(() => {
    session.problems.push(`Nothing conclusive after ${timeoutMs / 1000} s.`);
    finish(1000, 'check timed out');
  }, timeoutMs);
  await waitForClose(ws, timeoutMs + 5000);
  clearTimeout(timer);
  finish(1000, 'done');
  wss.close();
  if (recorder) {
    // The upstream host is deliberately left out: fixtures are committed, hosts are not.
    recorder.write(opts.record, { mission: missionDir });
    console.log(`recorded ${opts.record}`);
  }
  return verdict(session, live.assert, opts, `${missionDir} live`, { stopped: workshopStop(session) ?? upstreamProblem });
}

async function main() {
  if (!nodeSupported()) {
    console.error(nodeTooOld());
    return 2;
  }
  const { positional, opts } = parseArgs(process.argv.slice(2));
  const [mode, mission, scenario] = positional;
  if (!mode || !mission || !['list', 'replay', 'live'].includes(mode)) {
    console.error('usage: harness.mjs list|replay|live <mission> [scenario] [--record file] [--port n] [--dump file]');
    return 2;
  }
  const dir = resolveMission(mission);
  if (mode === 'list') {
    const { replay, live } = await loadCheck(dir);
    console.log(JSON.stringify({ mission: dir, replay: replay.map((s) => s.name), live: Boolean(live) }));
    return 0;
  }
  const pass = mode === 'replay' ? await runReplay(dir, scenario, opts) : await runLive(dir, opts);
  return pass ? 0 : 1;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(`harness: ${err.message}`);
    console.log(`VERDICT ${JSON.stringify({ pass: false, error: err.message, results: [] })}`);
    process.exit(2);
  },
);
