// Where a live check relays to (harness.mjs live mode).

const PROD_AGENT_URL = 'wss://agent.deepgram.com/v1/agent/converse';

// Every error message here leaves the value out: it can name an endpoint that
// belongs out of logs, and CI logs are public once the repository is.

// What DEEPGRAM_AGENT_URL or WORKSHOP_URL must look like, the same pattern body as common.py,
// common.ts and Credentials.java (tools/parity/addresses.json): ws:// or wss://, a host, an
// optional port from 1 to 65535, then printable ASCII only.
const ADDRESS = new RegExp(
  String.raw`^(?:wss?://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9._-]+)(?::([0-9]{1,5}))?(?:[/?#][\x21-\x7E]*)?)$`,
);
export const BAD_AGENT_URL =
  "DEEPGRAM_AGENT_URL isn't a valid address. Copy it again, or leave it empty for Deepgram production.";
export const BAD_WORKSHOP_URL =
  "WORKSHOP_URL isn't a valid address. Copy it again from the workshop's /code page.";

/** True when `url` is an address a WebSocket can open: the pattern, the port range, `new URL`. */
export function validAddress(url) {
  const m = ADDRESS.exec(url);
  if (!m || (m[2] !== undefined && !(Number(m[2]) >= 1 && Number(m[2]) <= 65535))) return false;
  try {
    new URL(url);
  } catch {
    return false;
  }
  return true;
}

/** Throws unless `url` starts ws:// or wss:// (`name`, `fix`), then unless it is valid (`bad`). */
function mustBeWebSocketUrl(url, name, fix, bad) {
  if (!/^wss?:\/\//.test(url)) throw new Error(`${name} must be a wss:// URL (or ws:// for a local endpoint). ${fix}`);
  if (!validAddress(url)) throw new Error(bad);
}

/** A wss:// host or the full converse URL -> the full converse URL. */
export function upstreamUrl(raw) {
  const url = (raw || PROD_AGENT_URL).trim().replace(/\/+$/, '');
  mustBeWebSocketUrl(url, 'DEEPGRAM_AGENT_URL', 'Leave it empty for Deepgram production.', BAD_AGENT_URL);
  return /\/v1\/agent\/converse$/.test(url) ? url : `${url}/v1/agent/converse`;
}

/** `wss://host/sdk` (or https://) -> `wss://host/sdk/<mission>/v1/agent/converse`. */
export function workshopUpstream(raw, missionDir) {
  let url = String(raw).trim().replace(/^https:/, 'wss:').replace(/^http:/, 'ws:').replace(/\/+$/, '');
  url = url.replace(/\/v1\/agent\/converse$/, '');
  mustBeWebSocketUrl(url, 'WORKSHOP_URL', "Copy it again from the workshop's /code page.", BAD_WORKSHOP_URL);
  // The site's own address (no /sdk) reaches no proxy, which reads like a closed one.
  if (!url.endsWith('/sdk')) throw new Error("WORKSHOP_URL should end in /sdk. Copy both lines from the workshop's /code page into .env.");
  return `${url}/${missionDir}/v1/agent/converse`;
}

/**
 * Where a live check relays to, whether that is the workshop proxy, and a
 * label to print. DEEPGRAM_AGENT_URL wins (with your own DEEPGRAM_API_KEY: a
 * workshop token is never relayed there, so with a token and no key it throws);
 * else, with WORKSHOP_TOKEN and WORKSHOP_URL both set, the workshop proxy, even
 * with a DEEPGRAM_API_KEY in the shell (the program sends the token too, as
 * common.py and common.ts choose it); else production. The label never names a host: CI logs are public once the repo
 * is, and DEEPGRAM_AGENT_URL can point at a host that must stay out of them.
 */
export function liveTarget(env, missionDir) {
  const set = (name) => Boolean(env[name]?.trim());
  if (set('DEEPGRAM_AGENT_URL')) {
    if (!set('DEEPGRAM_API_KEY') && set('WORKSHOP_TOKEN')) {
      throw new Error('DEEPGRAM_AGENT_URL needs your own DEEPGRAM_API_KEY. With a workshop token, leave DEEPGRAM_AGENT_URL empty: the workshop proxy picks the endpoint.');
    }
    const url = upstreamUrl(env.DEEPGRAM_AGENT_URL);
    return { url, workshop: false, label: url === PROD_AGENT_URL ? 'production' : 'custom endpoint' };
  }
  if (set('WORKSHOP_TOKEN') && set('WORKSHOP_URL')) return { url: workshopUpstream(env.WORKSHOP_URL, missionDir), workshop: true, label: 'workshop proxy' };
  return { url: upstreamUrl(''), workshop: false, label: 'production' };
}

/** `text` with the target's host (and hostname) replaced by its label, for error lines. */
export function withoutHost(text, url, label) {
  let out = String(text ?? '');
  try {
    const { host, hostname } = new URL(url);
    for (const h of [host, hostname]) if (h) out = out.split(h).join(label);
  } catch { /* not a URL: nothing to hide */ }
  return out;
}

