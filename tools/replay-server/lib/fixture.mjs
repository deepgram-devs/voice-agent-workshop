// Fixture files: one JSON object per line, run top to bottom against one client.
// The format is documented in CONTRIBUTING.md. Step kinds:
//   {"recv": {...}}                     server sends this JSON frame to the client
//   {"recv_binary": {"bytes": 4800}}    server sends that many bytes of silence (agent audio)
//   {"expect": "Settings", "timeout_ms": 5000}   wait for the client to send a frame of that type
//   {"expect": "close"}                 wait for the client to close the connection
//   {"wait_ms": 200}                    pause
//   {"close": {"code": 1000, "reason": ""}}       server closes the connection
//   {"note": "..."} or {"meta": {...}}  ignored; for humans
// Strings inside "recv" frames may use {{settings.<path>}}, filled from the client's Settings.

import { readFileSync } from 'node:fs';
import { get } from './session.mjs';

const DEFAULT_EXPECT_MS = Number(process.env.REPLAY_EXPECT_MS) || 5000;
const MAX_BINARY_BYTES = 1_000_000;

export function loadFixture(path) {
  const text = readFileSync(path, 'utf8');
  const steps = [];
  text.split('\n').forEach((line, i) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('//')) return;
    let step;
    try {
      step = JSON.parse(trimmed);
    } catch (err) {
      throw new Error(`${path}:${i + 1}: not valid JSON (${err.message})`);
    }
    if (step.note !== undefined || step.meta !== undefined) return;
    const kinds = ['recv', 'recv_binary', 'expect', 'wait_ms', 'close'].filter((k) => k in step);
    if (kinds.length !== 1) throw new Error(`${path}:${i + 1}: a step needs exactly one of recv, recv_binary, expect, wait_ms, close`);
    steps.push({ ...step, line: i + 1 });
  });
  return steps;
}

/** A value spliced into a longer string: lists and objects as JSON, so [] reads "[]", never "". */
function inline(v) {
  if (v === undefined || v === null) return '';
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

/**
 * Fill {{settings.path}} templates in a frame from the client's Settings.
 * A string that is only a template takes the value as is (a list stays a list,
 * an empty list stays []); a template inside a longer string is spliced in as
 * text, with lists and objects written as JSON. A missing path gives "".
 */
export function fillTemplates(value, settings) {
  if (typeof value === 'string') {
    const whole = value.match(/^\{\{\s*settings\.([\w.]+)\s*\}\}$/);
    if (whole) return get(settings, whole[1]) ?? '';
    return value.replace(/\{\{\s*settings\.([\w.]+)\s*\}\}/g, (_, p) => inline(get(settings, p)));
  }
  if (Array.isArray(value)) return value.map((v) => fillTemplates(v, settings));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fillTemplates(v, settings)]));
  return value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Run fixture steps against one connected client.
 * `io` is { sendJson(frame), sendBinary(buf), close(code, reason), waitForClient(predicate, ms) }.
 */
export async function runFixture(steps, session, io) {
  for (const step of steps) {
    if (session.close) {
      // The client hung up. Anything still to send is moot; a pending expect is a stall
      // unless it was waiting for exactly this.
      if ('expect' in step && step.expect !== 'close') session.stalled ??= { line: step.line, waitingFor: step.expect, reason: 'client closed first' };
      if ('expect' in step || 'recv' in step || 'recv_binary' in step) continue;
    }
    if ('recv' in step) {
      io.sendJson(fillTemplates(step.recv, session.settings ?? {}));
    } else if ('recv_binary' in step) {
      const n = Math.min(Number(step.recv_binary?.bytes ?? 0), MAX_BINARY_BYTES);
      if (n > 0) io.sendBinary(Buffer.alloc(n));
    } else if ('wait_ms' in step) {
      await sleep(Number(step.wait_ms));
    } else if ('expect' in step) {
      const ms = Number(step.timeout_ms ?? DEFAULT_EXPECT_MS);
      const want = typeof step.expect === 'string' ? step.expect : step.expect?.type;
      const ok = await io.waitForClient(want, ms);
      if (!ok) {
        session.stalled = { line: step.line, waitingFor: want, reason: `nothing after ${ms} ms` };
        break;
      }
    } else if ('close' in step) {
      io.close(step.close?.code ?? 1000, step.close?.reason ?? '');
      return;
    }
  }
}
