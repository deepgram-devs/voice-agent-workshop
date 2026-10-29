# 03 No dead air

**Goal:** an agent that calls your code to run a tool, gets a real answer back, and talks through the wait when the tool is slow.

**You'll learn**

- The round trip behind a tool call: request, your code, response
- Why the `id` on your response is the whole handshake
- How to cover dead air with one `InjectAgentMessage` before a slow tool runs

**Layer:** thinking.

## Before you start

- **Runs on your own key:** yes. Function calls and injected agent lines work on any Deepgram project. The optional stretch at the bottom of this page, and of your start file, uses the `thinking` feature, on a Deepgram project that has it.
- Your start file open in your editor: `python/missions/03-no-dead-air/start.py`, `typescript/missions/03-no-dead-air/start.ts` or `java/missions/m03_no_dead_air/Start.java`. The rest of this page calls it your start file.

## What you're building

Your agent manages a to-do list with four functions: `addItem`, `listItems`, `completeItem` and `deleteItem`. The list starts with three items: Buy milk, Call the dentist, Book the flight home.

A tool call (the agent asking your code to run a function and waiting for the answer) is a round trip:

```text
you say "delete milk"
agent  -> FunctionCallRequest   { functions: [{ id, name: "deleteItem", arguments: "{\"item\":\"milk\"}" }] }
your program runs deleteItem
you    -> FunctionCallResponse  { id, name, content: "Deleted \"Buy milk\". 2 items on the list." }
agent  reads your content and answers out loud
```

The agent has nothing to say between the request and your response. That silence is **dead air**. `deleteItem` takes three seconds on purpose, like a lookup against a slow database, so the caller hears three seconds of nothing. You fix that by having the agent say a short line first, with `InjectAgentMessage`.

## Do this

Each TODO sits at a `TODO n:` comment in your start file, with the exact call to make.

1. **Return a real result from `deleteItem`.** The start file waits three seconds and then returns `"TODO"`, and the agent reads that out loud. Find the item (the finder is already written), remove it from the list (the removal call is in your language's block), and return a short sentence that says what you did, for example `Deleted "Buy milk". 2 items on the list.` If nothing matches, say that instead. The other tools above it show the shape; none of them removes anything.
2. **Answer with the request's `id`.** Each call in a `FunctionCallRequest` has an `id`, and your `FunctionCallResponse` must carry the same one. That's how the agent matches answers to requests. The start file sends an empty id. When the id doesn't match, the agent never gets its answer and goes quiet for good.
3. **Cover the wait.** Before a tool in `SLOW_TOOLS` runs, send `FILLER` with [`InjectAgentMessage`](https://developers.deepgram.com/docs/voice-agent-inject-agent-message), behavior `queue`. `queue` means "after anything already queued", so the line waits its turn instead of cutting in. It has to go out as soon as the request arrives. A filler sent after the tool finishes is too late.

<details>
<summary>Python</summary>

- Your start file: [`python/missions/03-no-dead-air/start.py`](../../python/missions/03-no-dead-air/start.py); the reference answer is `solution.py` beside it.
- Every `agent.` call is `async`: `await` each one; the comments show it.
- TODO 1: `hit = find_item(args.get("item", ""))`, then `items.remove(hit)`.
- TODO 2: the request's id is `call["id"]`.
- TODO 3: `await agent.inject_agent_message(FILLER, behavior="queue")`.

</details>

<details>
<summary>TypeScript</summary>

- Your start file: [`typescript/missions/03-no-dead-air/start.ts`](../../typescript/missions/03-no-dead-air/start.ts); the reference answer is `solution.ts` beside it.
- TODO 1: `const hit = findItem(args.item)`, then `items = items.filter((i) => i !== hit)`.
- TODO 2: the request's id is `call.id`.
- TODO 3: `agent.injectAgentMessage(FILLER, 'queue')`.

</details>

<details>
<summary>Java</summary>

- Your start file: [`java/missions/m03_no_dead_air/Start.java`](../../java/missions/m03_no_dead_air/Start.java); the reference answer is `Solution.java` beside it.
- TODO 1: `Item hit = findItem(item(args))`, as `completeItem` does above it, then `items.remove(hit)`.
- TODO 2: the request's id is `call.str("id")`.
- TODO 3: `agent.injectAgentMessage(FILLER, "queue")`.

</details>

## Verify

**Run the checks.**

```sh
make check 03             # from the project folder. Offline: two recorded calls. No key
make live 03              # live: a real call with your key or a workshop token
# in Docker: docker compose run --rm workshop make check 03   (workshop-java in the Java service)
# in Docker: docker compose run --rm workshop make live 03   (workshop-java in the Java service)
```

The offline check replays two calls:

- **slow-delete:** a `deleteItem` request. It passes when your response carries the request's `id` and a real result that names the item (TODO 1, TODO 2). It also needs your `InjectAgentMessage` to go out before the response, within one second of the request (TODO 3).
- **quick-list:** a `listItems` request. It passes when your response carries the request's `id` and lists the three starting items. No filler is needed for a quick tool.

The live check types "Please delete buy milk from my to-do list." and runs the same checks against the real agent. It also checks that the agent accepted your filler (no `INJECT_AGENT_MESSAGE_DURING_*` warning) and that it spoke after your result came back. Every check reads the frames (the JSON messages) on the wire: the request, what your program sent and when. Nothing is self-reported.

**Talk to it.** Needs your key or a workshop token in `.env` ([README: Your API key](../../README.md#your-api-key)).

```sh
make run 03               # from the project folder, in the language you picked with make use
# in Docker: docker compose run --rm workshop make run 03   (workshop-java in the Java service)
```

Type:

> "delete milk"

With TODO 3 done, the agent says "One second, let me find that.", then the confirmation three seconds later. Then:

> "what's on my list?"

Two items, and milk is gone. Ctrl-D (or Ctrl-C) hangs up. In Docker or Codespaces you hear nothing during the run: read the transcript lines, and play `out/last-call.wav` on your machine after you hang up.

## Stuck?

| You see | What's happening | Fix |
|---|---|---|
| `FAIL  TODO 2: the FunctionCallResponse carries the id from the request ("call_delete_milk_1")`, or the agent goes quiet for good after `delete milk` in `make run 03` | Your `FunctionCallResponse` carries an empty or different `id`, so the agent never gets its answer. | Use the request's `id` (TODO 2). |
| `FAIL  TODO 1: deleteItem returns what it did, for example: Deleted "Buy milk". 2 items on the list.`, or the agent says "TODO" out loud | `deleteItem` still returns `"TODO"`. | Return a short sentence that says what you did (TODO 1). |
| `FAIL  TODO 1: the deleteItem result names the item it deleted (milk)` | Your sentence leaves out the item. | Name it: `Deleted "Buy milk". 2 items on the list.` |
| The agent confirms the delete, but "what's on my list?" still lists milk (`make run 03`) | You returned a sentence without removing the item. | Remove it: your language's block under Do this has the call (TODO 1). |
| `FAIL  TODO 3: send an InjectAgentMessage filler line when the slow tool is requested`, or `FAIL  TODO 3: send the filler as soon as the request arrives, before the slow tool runs (it went out after N ms)` | No filler, or one sent after the tool finished or more than a second after the request; N is how late. | Send `FILLER` the moment the request arrives, before the tool runs, behavior `queue` (TODO 3). |
| `FAIL  TODO 3: the filler line has something to say` | `FILLER` is empty. | Give it a short line ("One second, let me find that."). |
| `FAIL  TODO 3: send the filler line before the tool result (FunctionCallResponse)` | The filler went out after your `FunctionCallResponse`. | Send `FILLER` the moment the request arrives, before the tool runs (TODO 3). |
| `FAIL  TODO 1: deleteItem returns what it did, not "TODO"` in `make live 03` | The live form of the `TODO 1` row above. | Return a short sentence that says what you did (TODO 1). |
| `FAIL  TODO 3: the agent refused your filler line (INJECT_AGENT_MESSAGE_DURING_AGENT_SPEECH). Send it with behavior "queue" so it waits its turn` or `FAIL  TODO 3: the agent refused your filler line (INJECT_AGENT_MESSAGE_DURING_USER_SPEECH): the caller was still talking when it went out. Nothing to change if it goes out the moment the request arrives (TODO 3); run it again` in `make live 03` (a `Warning` with that code arrived); or an `Agent warning:` line ending in either code in `make run 03` (`USER_SPEECH` only with the microphone: `MIC=1`, Python; the live check and a typed run never trigger it) | The agent refuses `default` while it is speaking, and `default` or `queue` while the caller is speaking; `interrupt` is never refused ([Errors and warnings](https://developers.deepgram.com/docs/voice-agent-errors-warnings) lists both codes). `AGENT_SPEECH`: your filler went out with `default`. `USER_SPEECH`: it went out with `default` or `queue` while the caller was still talking. | `AGENT_SPEECH`: send `FILLER` with behavior `queue` (TODO 3). `USER_SPEECH`: nothing to change if it goes out the moment the request arrives (TODO 3); run it again. |
| `[note] Settings sent as raw JSON: this SDK release has no field for part of it (the check reads it the same)` (Python: the first line of pytest's `Captured stdout call`; Java: under `Checking your Java file:`, once per replay), `CONCURRENCY_LIMIT_REACHED`, or `[note] ... (VOICE_PROMPT_ADDED)` | `THINKING_MODEL` is set in `.env`: the stretch at the bottom of this page is on. | Nothing for the mission. The Stretch section says what each line means, and [Troubleshooting](../../docs/troubleshooting.md) has a row per line. |

<details>
<summary>Python</summary>

| You see | What's happening | Fix |
|---|---|---|
| `FAIL  TODO 3: send an InjectAgentMessage filler line when the slow tool is requested` with `RuntimeWarning: coroutine 'Agent.inject_agent_message' was never awaited` at the bottom of the output | The filler ran without `await`, so it never went out. | `await agent.inject_agent_message(FILLER, behavior="queue")`. |

</details>

Truly stuck? The reference answer is beside your start file (your language's block under Do this names it). Reading it is part of the workshop, so open it when you need it; `make check 03 MISSION_TARGET=solution` runs it.

Anything else is in the README's [Troubleshooting](../../README.md#troubleshooting), which points at your language's page.

## Check yourself

Your filler goes out after `deleteItem` returns. What does the caller hear?

<details>
<summary>Answer</summary>

Three seconds of nothing, then the filler and the confirmation back to back. The filler has to go out as soon as the request arrives; `queue` makes it wait its turn behind anything already queued, which at that moment is nothing.

</details>

## Stretch: let the model cover the wait (optional)

Not part of the check, and live: it needs your key on a Deepgram project that has the `thinking` feature, or a workshop token. The `thinking` feature is a think provider built for voice: it tends to say something before it calls a tool, with no filler code.

Both values come from `.env`. Put the `thinking` model id in `THINKING_MODEL`. If it runs on its own agent endpoint (the address a program connects to), put that address in `DEEPGRAM_AGENT_URL`. The code under `Stretch (optional)` in your start file then asks for the `thinking` provider in its Settings. Deepgram's [think models reference](https://developers.deepgram.com/reference/voice-agent/think-models) shows how to list the think models your key can use. With a workshop token, set only `THINKING_MODEL` (any non-empty value: the workshop uses its own model id) and keep `DEEPGRAM_AGENT_URL` empty. The proxy runs `thinking` whenever the workshop has it switched on; otherwise your run prints a `FEATURE_OFF` warning and carries on with the usual model.

```json
{ "think": { "provider": { "type": "deepgram", "model": "<THINKING_MODEL>", "reasoning_mode": "none" }, "prompt": "<PROMPT>", "functions": ["<your four FUNCTIONS>"] } }
```

That `think` block replaces the usual one in your Settings. Keep `reasoning_mode` at `none`: it's the only value the `thinking` model accepts today. With `thinking` on, your run may also print one `[note]` line about voice style instructions (`VOICE_PROMPT_ADDED`); that's expected. If it prints `CONCURRENCY_LIMIT_REACHED`, the model is busy: wait a minute, or leave `THINKING_MODEL` empty to carry on. Where the SDK's models don't know this provider, the helpers send the same Settings as raw JSON and say so in one `[note]` line (Python and Java; the Stuck? table quotes it). Then take the filler out of your handler and listen to the difference.
