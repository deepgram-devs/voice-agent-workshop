// Turn a live session into a fixture file that `replay` can play back.
// Client frames become `expect` steps (type only; your prompt never lands in the
// file), server frames become `recv` steps, runs of agent audio collapse into one
// `recv_binary`, and gaps of 250 ms or more become `wait_ms`. Headers and keys are
// never seen by the recorder.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const MIN_GAP_MS = 250;
const MAX_GAP_MS = 3000;
const SKIP_EXPECT = new Set(['KeepAlive']);

export class Recorder {
  constructor(session) {
    this.session = session;
  }

  lines(meta) {
    const out = [{ meta: { ...meta, recorded_at: new Date().toISOString().slice(0, 10) } }];
    let lastServerAt = null;
    let pendingAudio = 0;
    const flushAudio = () => {
      if (pendingAudio > 0) out.push({ recv_binary: { bytes: pendingAudio } });
      pendingAudio = 0;
    };
    for (const e of this.session.events) {
      if (e.dir === 'harness') {
        flushAudio();
        out.push({ note: e.audio ? `harness played ${e.audio} here during the live run` : `harness injected ${e.frame?.type ?? 'a frame'} here during the live run` });
        continue;
      }
      if (e.dir === 'client') {
        if (e.bytes || SKIP_EXPECT.has(e.frame?.type)) continue;
        flushAudio();
        out.push({ expect: e.frame?.type ?? 'unknown' });
        continue;
      }
      if (lastServerAt !== null && e.at - lastServerAt >= MIN_GAP_MS) {
        flushAudio();
        out.push({ wait_ms: Math.min(e.at - lastServerAt, MAX_GAP_MS) });
      }
      lastServerAt = e.at;
      if (e.bytes) pendingAudio += e.bytes;
      else {
        flushAudio();
        out.push({ recv: e.frame });
      }
    }
    flushAudio();
    const c = this.session.close;
    if (c?.by === 'server') out.push({ close: { code: c.code, reason: c.reason ?? '' } });
    return out;
  }

  write(path, meta) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${this.lines(meta).map((l) => JSON.stringify(l)).join('\n')}\n`);
  }
}
