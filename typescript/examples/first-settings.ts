// The smallest Voice Agent program on the Deepgram TypeScript SDK, with no helpers.
//
// It sends Settings, waits for SettingsApplied before it sends anything else, lets
// you type turns, and saves the agent's voice to out/last-call.wav, as `make run`
// does. The missions do the same through src/common.ts, which adds the workshop
// token path and error hints; read this file to see the SDK calls on their own.
//
// Run it from typescript/:   pnpm tsx examples/first-settings.ts [path/to/voice.wav]
// It reads DEEPGRAM_API_KEY from ../.env or the shell. Type a line and press Enter;
// Ctrl-C hangs up. DEEPGRAM_AGENT_URL picks another agent host (the offline test uses it).

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { DeepgramClient, type Deepgram } from '@deepgram/sdk';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUTPUT_RATE = 24000;

const SETTINGS: Deepgram.agent.AgentV1Settings = {
  type: 'Settings',
  audio: {
    input: { encoding: 'linear16', sample_rate: 16000 },
    output: { encoding: 'linear16', sample_rate: OUTPUT_RATE, container: 'none' },
  },
  agent: {
    listen: { provider: { type: 'deepgram', model: 'nova-3', version: 'v1' } },
    think: { provider: { type: 'open_ai', model: 'gpt-4o-mini' }, prompt: 'You are a friendly voice agent. Keep replies short.' },
    speak: { provider: { type: 'deepgram', model: 'flux-hannah-en', version: 'v2' } },
    greeting: 'Hi there. Type something and I will answer.',
  },
} as Deepgram.agent.AgentV1Settings;

function makeClient(apiKey: string): DeepgramClient {
  const host = (process.env.DEEPGRAM_AGENT_URL ?? '').trim().replace(/\/+$/, '').replace(/\/v1\/agent\/converse$/, '');
  if (!host) return new DeepgramClient({ apiKey }); // production: wss://agent.deepgram.com
  const environment = { base: 'https://api.deepgram.com', production: 'wss://api.deepgram.com', agent: host, agentRest: host.replace(/^ws/, 'http') };
  return new DeepgramClient({ apiKey, environment });
}

function saveWav(path: string, chunks: Buffer[]): void {
  const data = Buffer.concat(chunks);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(OUTPUT_RATE, 24);
  header.writeUInt32LE(OUTPUT_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); // linear16
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, Buffer.concat([header, data]));
  console.log(`[saved] the agent's voice is in ${path}`);
}

loadDotenv({ path: join(PROJECT_ROOT, '.env'), quiet: true });
const apiKey = process.env.DEEPGRAM_API_KEY?.trim();
if (!apiKey) {
  // The same two states as the missions' line (src/common.ts), in this example's own words: it
  // reads the key only; the helpers add the workshop token path.
  console.error(
    existsSync(join(PROJECT_ROOT, '.env'))
      ? 'DEEPGRAM_API_KEY is empty in .env (this folder). Set it: this example runs ' +
          'on your own key only (make run takes a workshop token too). ' +
          'make check NN runs offline with no key.'
      : 'No Deepgram credentials. Copy .env.example to .env and set DEEPGRAM_API_KEY ' +
          '(free key: https://console.deepgram.com/signup): this example runs on ' +
          'your own key only (make run takes a workshop token too).',
  );
  process.exit(2);
}
// Printable ASCII only: a header can't carry a curly quote, and a space is a paste error.
if (!/^[\x21-\x7e]+$/.test(apiKey)) {
  console.error("DEEPGRAM_API_KEY has a character a key can't have (a curly quote or a hidden space, often from copy and paste). Copy it again as plain text.");
  process.exit(2);
}
const wavPath = process.argv[2] ? resolve(process.argv[2]) : join(PROJECT_ROOT, 'out', 'last-call.wav');

// reconnectAttempts 0: a dropped call ends the program (src/resilient.ts shows reconnecting).
const socket = await makeClient(apiKey).agent.v1.connect({ reconnectAttempts: 0 });
const audio: Buffer[] = [];
const pending: string[] = []; // lines typed before SettingsApplied wait here
let ready = false;
let keepAlive: NodeJS.Timeout | undefined;
const rl = process.stdin.isTTY ? createInterface({ input: process.stdin }) : null;
let chain = Promise.resolve(); // keeps audio and events in arrival order

// 1. Settings first, as soon as the socket opens: the agent ignores everything until then.
socket.on('open', () => socket.sendSettings(SETTINGS));

socket.on('message', (message: unknown) => {
  chain = chain.then(async () => {
    if (message instanceof Blob) {
      audio.push(Buffer.from(await message.arrayBuffer())); // 3. the agent's voice: linear16 at 24 kHz
      return;
    }
    const event = message as { type?: string; role?: string; content?: string; description?: string; code?: string };
    if (event.type === 'SettingsApplied') {
      // 2. Now, and only now, the agent takes turns and KeepAlive.
      ready = true;
      console.log('[ready] type a line and press Enter');
      for (const line of pending.splice(0)) socket.sendInjectUserMessage({ type: 'InjectUserMessage', content: line });
      keepAlive = setInterval(() => socket.sendKeepAlive({ type: 'KeepAlive' }), 5000);
    } else if (event.type === 'ConversationText') console.log(`${event.role}: ${event.content}`);
    else if (event.type === 'Error') console.log(`Agent error: ${event.description} (${event.code})`);
  });
});

rl?.on('line', (line) => {
  const text = line.trim();
  if (!text) return;
  if (ready) socket.sendInjectUserMessage({ type: 'InjectUserMessage', content: text });
  else pending.push(text);
});

// Before SettingsApplied, an error is a connection that never opened: the helpers' one line
// (src/common.ts connectFailure), read from the error's code, since Node's message names the
// address and an AggregateError's message is empty. Never the error itself: it can carry the
// request headers, key included. Then exit 2, as the helpers' SetupError does.
socket.on('error', (err) => {
  const e = err as Error & { code?: unknown; errors?: Array<{ code?: unknown }> };
  if (ready) {
    console.error(`[socket error] ${e.message}`);
    return;
  }
  const status = /Unexpected server response: (\d{3})/.exec(e.message)?.[1];
  if (status) {
    console.error(`Deepgram refused the connection (HTTP ${status}).`);
    process.exit(2);
  }
  const codes = [e.code, e.errors?.find((x) => x?.code)?.code, /\bE[A-Z0-9_]{3,}\b/.exec(e.message)?.[0]];
  const code = codes.find((c): c is string => typeof c === 'string');
  const detail =
    code === 'ECONNREFUSED' ? 'connection refused'
    : code === 'ENOTFOUND' || code === 'EAI_AGAIN' ? 'no such host'
    : code === 'ETIMEDOUT' ? 'it timed out'
    : (code ?? 'the connection failed');
  console.error(`Could not reach the agent: ${detail}. Check DEEPGRAM_AGENT_URL.`);
  process.exit(2);
});
process.once('SIGINT', () => socket.close()); // Ctrl-C hangs up; the voice still gets saved
socket.connect(); // handlers first, then open the connection

await new Promise<void>((done) =>
  socket.on('close', (event) => {
    if (event.code !== 1000 && event.code !== 1005) console.log(`[closed] ${event.code} ${event.reason}`);
    done();
  }),
);
await chain;
clearInterval(keepAlive);
rl?.close();
if (audio.length) saveWav(wavPath, audio);
process.exit(0);
