// A record of one connection: every frame in both directions, in order.
// Mission checks (missions/NN-name/check.mjs) read this and nothing else.

export class Session {
  constructor() {
    this.startedAt = Date.now();
    /** Every frame, in order: { dir: 'client' | 'server', at, frame } or { dir, at, bytes } for audio. */
    this.events = [];
    /** How the connection ended: { by: 'client' | 'server' | 'harness', code, reason, at } or null. */
    this.close = null;
    /** Set when a fixture step waited for a client frame that never came: { step, waitingFor }. */
    this.stalled = null;
    /** Problems the harness itself hit (bad JSON from the client, upstream errors). */
    this.problems = [];
  }

  now() {
    return Date.now() - this.startedAt;
  }

  addJson(dir, frame) {
    this.events.push({ dir, at: this.now(), frame });
  }

  addBinary(dir, bytes) {
    this.events.push({ dir, at: this.now(), bytes });
  }

  /** JSON frames the client (your program) sent, in order. */
  get sent() {
    return this.events.filter((e) => e.dir === 'client' && e.frame).map((e) => e.frame);
  }

  /** JSON frames the server sent to your program, in order. */
  get received() {
    return this.events.filter((e) => e.dir === 'server' && e.frame).map((e) => e.frame);
  }

  /** The first Settings message your program sent, or null. */
  get settings() {
    return this.sent.find((f) => f.type === 'Settings') ?? null;
  }

  sentOfType(type) {
    return this.sent.filter((f) => f.type === type);
  }

  receivedOfType(type) {
    return this.received.filter((f) => f.type === type);
  }

  /** Index into `events` of the first frame matching dir and type, or -1. Use it to check order. */
  indexOf(dir, type, from = 0) {
    for (let i = from; i < this.events.length; i++) {
      const e = this.events[i];
      if (e.dir === dir && e.frame?.type === type) return i;
    }
    return -1;
  }

  /** Bytes of audio sent by the client (mic) and by the server (agent voice). */
  get audioBytesSent() {
    return this.events.filter((e) => e.dir === 'client' && e.bytes).reduce((n, e) => n + e.bytes, 0);
  }

  get audioBytesReceived() {
    return this.events.filter((e) => e.dir === 'server' && e.bytes).reduce((n, e) => n + e.bytes, 0);
  }

  /** Assistant lines from ConversationText, in order. */
  get agentLines() {
    return this.receivedOfType('ConversationText').filter((f) => f.role === 'assistant').map((f) => f.content);
  }

  /** User lines from ConversationText, in order. */
  get userLines() {
    return this.receivedOfType('ConversationText').filter((f) => f.role === 'user').map((f) => f.content);
  }

  toJSON() {
    return { events: this.events, close: this.close, stalled: this.stalled, problems: this.problems };
  }
}

/** Read a dotted path ("agent.speak.provider.model") from an object. Missing parts give undefined. */
export function get(obj, path) {
  let cur = obj;
  for (const part of String(path).split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}
