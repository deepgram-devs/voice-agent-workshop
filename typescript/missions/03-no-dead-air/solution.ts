// Mission 03, No dead air: answer a tool call, and cover the wait while a slow one runs.
//
// Run it:    pnpm tsx missions/03-no-dead-air/solution.ts
// Check it:  make check 03      (offline, no key)
// Live:      make live 03       (real API, uses your DEEPGRAM_API_KEY)
//
// Reference solution. Try start.ts first.

import { isMain, listenProvider, run, type Agent, type AgentEvent, type Settings } from '../../src/common.js';

const PROMPT =
  'You are a to-do list assistant at a developer conference. Keep replies to one short sentence. ' +
  'Use the tools to add, list, complete and delete items, and confirm what you did. ' +
  'Never use markdown or emoji.';

// The list every call starts with, so there is something to delete straight away.
const SEED_ITEMS = ['Buy milk', 'Call the dentist', 'Book the flight home'];

// deleteItem is slow on purpose, like a lookup against a slow database.
const SLOW_SECONDS = 3;
const SLOW_TOOLS = new Set(['deleteItem']);

// What the agent says while a slow tool runs.
const FILLER = 'One second, let me find that.';

const itemParam = (what: string) => ({
  type: 'object',
  properties: { item: { type: 'string', description: `${what}, in the caller's words. A partial match is fine.` } },
  required: ['item'],
});

// The four functions the agent can call. They travel in Settings as agent.think.functions.
const FUNCTIONS = [
  { name: 'deleteItem', description: 'Delete an item from the to-do list for good. This lookup is slow and takes about three seconds.', parameters: itemParam('The item to delete') },
  { name: 'completeItem', description: 'Mark an item on the to-do list as done. It stays on the list.', parameters: itemParam('The item to mark as done') },
  { name: 'addItem', description: 'Add a new item to the to-do list.', parameters: itemParam('The item to add') },
  { name: 'listItems', description: 'Read back every item on the to-do list with whether it is done.', parameters: { type: 'object', properties: {} } },
];

type Item = { text: string; done: boolean };
type Args = Record<string, unknown>;
type FunctionCall = { id: string; name: string; arguments?: string; client_side?: boolean };

// The to-do list for this call. onEvent resets it when a call starts.
let items: Item[] = [];

/** The item whose text best matches what the caller said, or undefined. */
function findItem(query: unknown): Item | undefined {
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return undefined;
  const direct = items.find((i) => i.text.toLowerCase().includes(q) || q.includes(i.text.toLowerCase()));
  if (direct) return direct;
  const words = q.split(/\s+/).filter((w) => w.length > 2);
  let best: Item | undefined;
  let bestScore = 0;
  for (const item of items) {
    const score = words.filter((w) => item.text.toLowerCase().includes(w)).length;
    if (score > bestScore) [best, bestScore] = [item, score];
  }
  return best;
}

const count = () => `${items.length} item${items.length === 1 ? '' : 's'} on the list.`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function addItem(args: Args): Promise<string> {
  const text = String(args.item ?? '').trim();
  if (!text) return 'Nothing to add: the item was empty.';
  items.push({ text, done: false });
  return `Added "${text}". ${count()}`;
}

async function listItems(): Promise<string> {
  if (items.length === 0) return 'The list is empty.';
  return items.map((i, n) => `${n + 1}. ${i.text}${i.done ? ' (done)' : ''}`).join(' ');
}

async function completeItem(args: Args): Promise<string> {
  const hit = findItem(args.item);
  if (!hit) return `No item matching "${String(args.item ?? '')}". ${count()}`;
  hit.done = true;
  return `Marked "${hit.text}" as done.`;
}

async function deleteItem(args: Args): Promise<string> {
  await sleep(SLOW_SECONDS * 1000); // the slow lookup this mission is built around
  const hit = findItem(args.item);
  if (!hit) return `No item matching "${String(args.item ?? '')}" to delete. ${count()}`;
  items = items.filter((i) => i !== hit);
  return `Deleted "${hit.text}". ${count()}`;
}

const TOOLS: Record<string, (args: Args) => Promise<string>> = { addItem, listItems, completeItem, deleteItem };

async function runTool(name: string, args: Args): Promise<string> {
  const tool = TOOLS[name];
  return tool ? tool(args) : `Unknown function: ${name}`;
}

// STRETCH (optional, not checked): the `thinking` feature, a think provider built
// for voice that covers the wait on its own. Put its model id in .env as
// THINKING_MODEL and your Settings ask for it (missions/03-no-dead-air/README.md).
const THINKING_MODEL = process.env.THINKING_MODEL?.trim() ?? '';

/**
 * The think block for the `thinking` provider, sent in your Settings.
 * If it runs on its own agent endpoint, put that endpoint in DEEPGRAM_AGENT_URL.
 */
function thinkingThink() {
  return {
    provider: { type: 'deepgram', model: THINKING_MODEL, reasoning_mode: 'none' },
    prompt: PROMPT,
    functions: FUNCTIONS,
  };
}

/** The Settings message: sent once, as soon as the server says Welcome. */
export function buildSettings(): Settings {
  return {
    audio: {
      input: { encoding: 'linear16', sample_rate: 16000 },
      output: { encoding: 'linear16', sample_rate: 24000, container: 'none' },
    },
    agent: {
      listen: { provider: listenProvider() },
      think: THINKING_MODEL ? thinkingThink() : { provider: { type: 'open_ai', model: 'gpt-4o-mini' }, prompt: PROMPT, functions: FUNCTIONS },
      speak: { provider: { type: 'deepgram', model: 'flux-hannah-en', version: 'v2' } },
    },
  } as Settings;
}

/** Every event from the agent lands here, as plain wire JSON. */
export async function onEvent(agent: Agent, event: AgentEvent): Promise<void> {
  if (event.type === 'Welcome') {
    items = SEED_ITEMS.map((text) => ({ text, done: false })); // a fresh list per call
  } else if (event.type === 'FunctionCallRequest') {
    for (const call of (event.functions ?? []) as FunctionCall[]) {
      if (call.client_side === false) continue; // the agent runs this one itself; answer only the calls meant for your code
      // Say something before the slow tool starts, so the caller isn't left in silence.
      if (SLOW_TOOLS.has(call.name)) agent.injectAgentMessage(FILLER, 'queue');
      const args = JSON.parse(call.arguments || '{}') as Args;
      const result = await runTool(call.name, args);
      agent.functionCallResponse(call.id, call.name, result);
    }
  }
}

if (isMain(import.meta.url)) await run({ buildSettings, onEvent });
