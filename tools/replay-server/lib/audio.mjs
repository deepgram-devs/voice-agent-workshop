// Recorded caller audio for live scripts: `{ after, send_audio: "fixtures/audio/x.wav" }`.
// Clips are mono 16-bit PCM WAV files. The harness streams them upstream in real
// time, as a microphone would, then a stretch of silence so the agent sees the
// turn end.

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { ROOT } from './missions.mjs';

export const CHUNK_MS = 20;
export const DEFAULT_SILENCE_MS = 2000;

/** Parse a RIFF/WAVE file into { sampleRate, pcm }. Only mono linear16 is accepted. */
export function parseWav(buf, label = 'clip') {
  if (buf.length < 12 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`${label} is not a WAV file`);
  }
  let fmt = null;
  let pcm = null;
  for (let at = 12; at + 8 <= buf.length; ) {
    const id = buf.toString('ascii', at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === 'fmt ') {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), sampleRate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      pcm = buf.subarray(body, Math.min(buf.length, body + size));
    }
    at = body + size + (size % 2);
  }
  if (!fmt || !pcm) throw new Error(`${label} has no fmt or data chunk`);
  if (fmt.format !== 1 || fmt.bits !== 16 || fmt.channels !== 1) {
    throw new Error(`${label} must be mono 16-bit PCM (linear16); it is format ${fmt.format}, ${fmt.channels} channel(s), ${fmt.bits}-bit`);
  }
  return { sampleRate: fmt.sampleRate, pcm };
}

/** Load a clip named in a live script. Paths are relative to the voice-agent-workshop folder. */
export function loadClip(path, silenceMs = DEFAULT_SILENCE_MS) {
  const file = isAbsolute(path) ? path : join(ROOT, path);
  if (!existsSync(file)) throw new Error(`live script: no audio file ${relative(ROOT, file)}`);
  const { sampleRate, pcm } = parseWav(readFileSync(file), relative(ROOT, file));
  const silence = Buffer.alloc(Math.round((sampleRate * Math.max(0, Number(silenceMs) || 0)) / 1000) * 2);
  return { path: relative(ROOT, file), sampleRate, speechBytes: pcm.length, pcm: Buffer.concat([pcm, silence]) };
}

/**
 * Send `clip.pcm` through `send(chunk)` at real-time pace, in CHUNK_MS chunks.
 * Resolves true when everything went out, false if `isOpen()` turned false first.
 */
export function streamClip(clip, send, isOpen) {
  const bytesPerMs = (clip.sampleRate * 2) / 1000;
  const chunk = Math.max(2, Math.round(bytesPerMs * CHUNK_MS) & ~1);
  const started = Date.now();
  let sent = 0;
  return new Promise((resolve) => {
    const tick = () => {
      if (!isOpen()) return resolve(false);
      // Stay one chunk ahead of the clock, never further.
      const due = Math.min(clip.pcm.length, (Math.floor((Date.now() - started) * bytesPerMs) & ~1) + chunk);
      while (sent < due) {
        const end = Math.min(sent + chunk, due);
        send(clip.pcm.subarray(sent, end));
        sent = end;
      }
      if (sent >= clip.pcm.length) return resolve(true);
      setTimeout(tick, CHUNK_MS);
    };
    tick();
  });
}
