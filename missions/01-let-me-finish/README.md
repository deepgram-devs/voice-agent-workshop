# 01 Let me finish

**Goal:** an agent that waits while you read out a phone number, and hangs up when you say goodbye.

**You'll learn**

- One Settings block, `think_live`, and its three knobs
- Why hanging up is your program's job, and the four-message handshake that ends a call
- How a backchannel and a presence check show up in the transcript

**Layer:** timing.

## Before you start

- **Runs on your own key:** on a Deepgram project that has the `timing` feature. On a project without it, Settings with the block gets `UNPARSABLE_CLIENT_MESSAGE`. In the room, the workshop token covers it; anywhere, `make check 01` runs offline with no key.
- Your start file open in your editor: `python/missions/01-let-me-finish/start.py`, `typescript/missions/01-let-me-finish/start.ts` or `java/missions/m01_let_me_finish/Start.java`. The rest of this page calls it your start file.

## What you're building

Most agents answer the moment you stop talking. Real people don't. The `timing` feature lets the agent judge whether a pause means "your turn" or "still thinking", instead of waiting out a fixed silence. With it on, the agent says "mm-hm" to keep you going, and checks in if you go quiet. The feature is `timing`; its Settings block is `think_live`; the three constants are its knobs. It all comes from one extra block in Settings:

```text
Settings
  agent.think        the language model, your prompt, and functions it may call
  agent.think_live   timing: the three knobs below
```

The block's shape, with the start file's values (`BACKCHANNEL`, `PRESENCE_INTERVAL_MS`, `PRESENCE_MAX`):

```json
"think_live": {
  "provider": {
    "type": "deepgram",
    "version": "v1",
    "agent_backchannel_sensitivity": 0.3,
    "presence_check_interval_ms": 4000,
    "presence_check_max_count": 2
  }
}
```

| Knob (its wire name: the field as the API spells it) | What it does |
|---|---|
| `agent_backchannel_sensitivity` | 0 to 1. How readily it says "mm-hm" or "go on" instead of taking the turn. At 0 it never interjects. |
| `presence_check_interval_ms` | The silence, in milliseconds, before each check; anything under 3000 counts as 3000. |
| `presence_check_max_count` | How many times it asks before it stays quiet for good. |

**Your code ends the call.** The agent keeps the line open, even after "bye", so hanging up is your program's job. You give the agent an `end_call` function; when it decides the caller is done, it sends a [`FunctionCallRequest`](https://developers.deepgram.com/docs/voice-agent-function-call-request). Your code answers it with a [`FunctionCallResponse`](https://developers.deepgram.com/docs/voice-agent-function-call-response), lets the agent say goodbye, and closes the connection once the goodbye has finished playing ([`AgentAudioDone`](https://developers.deepgram.com/docs/voice-agent-agent-audio-done)). [Function calling](https://developers.deepgram.com/docs/voice-agents-function-calling) is the overview; here is the handshake for `end_call`:

```text
user:   Okay, bye!
agent → FunctionCallRequest  { functions: [{ id, name: "end_call" }] }
you   → FunctionCallResponse { id, name: "end_call", content }
agent → ConversationText     "Thanks for calling. Goodbye!"   (plus its audio)
agent → AgentAudioDone       the goodbye has played
you   → close the connection
```

Backchannels and presence checks arrive as ordinary assistant `ConversationText` lines, with a `conversational_behavior` field that says which kind they are (`backchannel`, `presence_check`). Ordinary replies carry `default`.

## Do this

Each TODO sits at a `TODO n:` comment in your start file, with the exact call to make. TODO 1 is in the function that builds Settings. TODO 2 is at `END_CALL` near the top. TODOs 3 and 4 are in the event handler.

1. **Turn on timing.** Uncomment the block at TODO 1 (select the lines and press Cmd-/ or Ctrl-/). It adds `agent.think_live` with a `provider` object of type `deepgram`, version `v1`, and the three knobs inside that `provider` (`BACKCHANNEL`, `PRESENCE_INTERVAL_MS`, `PRESENCE_MAX`, already defined); the shape is above, and the start file already has it written.
2. **Tell the model when to hang up** (`END_CALL`). The `end_call` function is already written and listed in `agent.think.functions`, with its `name` and its `parameters` (a JSON Schema, the standard way to describe a function's arguments; empty here). Its `description` is `""`. Write one sentence: when should the model call it? The model reads that sentence to decide.
3. **Answer the request.** The loop over the request's `functions` and the `end_call` name test are written. Inside, reply with a `FunctionCallResponse` carrying the request's `id`, and remember that a hang-up is pending, so that `[hang up] the agent said goodbye` prints when it happens (TODO 4).
4. **Hang up after the goodbye.** When the next `AgentAudioDone` arrives and a hang-up is pending, close the connection. Close then and only then: on the request, the goodbye gets cut off; on any `AgentAudioDone`, the call ends after the greeting.

<details>
<summary>Python</summary>

- Your start file: [`python/missions/01-let-me-finish/start.py`](../../python/missions/01-let-me-finish/start.py); the reference answer is `solution.py` beside it.
- Every `agent.` call is `async`: `await` each one; the comments show it.
- TODO 1 is in `build_settings()`; TODOs 3 and 4 in `on_event()`.
- TODO 3: the pre-written loop hands you each entry of the request's `functions` list as `fn` and tests `fn.get("name")` for `end_call`; reply with `await agent.function_call_response(fn["id"], "end_call", "<any short text>")`.
- TODO 4: `await agent.close()`.

</details>

<details>
<summary>TypeScript</summary>

- Your start file: [`typescript/missions/01-let-me-finish/start.ts`](../../typescript/missions/01-let-me-finish/start.ts); the reference answer is `solution.ts` beside it.
- TODO 1 is in `buildSettings()`; TODOs 3 and 4 in `onEvent()`.
- TODO 3: the cast at TODO 3 is pre-written; it is the one the type-error line allows (`event.functions` is typed `unknown`, and the loop narrows it with `type FunctionRequest`). The loop hands you each entry of `event.functions` as `fn` and tests `fn.name` for `end_call`; reply with `agent.functionCallResponse(fn.id, 'end_call', '<any short text>')`.
- TODO 4: `agent.close()`.

</details>

<details>
<summary>Java</summary>

- Your start file: [`java/missions/m01_let_me_finish/Start.java`](../../java/missions/m01_let_me_finish/Start.java); the reference answer is `Solution.java` beside it.
- TODO 1 is in `buildSettings()`; TODOs 3 and 4 in `onEvent()`. Inside `buildSettings()`, `agent` is an `ObjectNode` from Jackson (the JSON library the SDK uses), and the pre-written block adds the nested object with `agent.set("think_live", obj(...))` (`set` is for an object, `put` for a string or a number). In `onEvent(agent, event)` the same word is the `agent.Agent` you reply through (TODOs 3 and 4): two variables, one name.
- TODO 3: the pre-written loop hands you each entry of `event.items("functions")` as `fn` and tests `fn.str("name")` for `end_call`; reply with `agent.functionCallResponse(fn.str("id"), "end_call", "<any short text>")`.
- TODO 4: `agent.close()`.

</details>

## Verify

**Run the checks.**

```sh
make check 01             # from the project folder. Offline: replays a call that ends with "okay, bye". No key
make live 01              # live: needs timing on your project, or a workshop token
# in Docker: docker compose run --rm workshop make check 01   (workshop-java in the Java service)
# in Docker: docker compose run --rm workshop make live 01   (workshop-java in the Java service)
```

The offline check passes on three things: Settings has the timing block and `end_call` has a description; your program answers the `end_call` request with the same `id`; the connection closes after the goodbye's `AgentAudioDone`. Closing earlier fails it. The live check types a caller line, "That's everything, thanks. Okay, bye!", after the greeting, and passes when the real agent calls `end_call` and your program hangs up.

**Talk to it.** Needs your key on a Deepgram project with `timing`, or a workshop token, in `.env` ([README: Your API key](../../README.md#your-api-key)).

```sh
make run 01               # from the project folder, in the language you picked with make use
# in Docker: docker compose run --rm workshop make run 01   (workshop-java in the Java service)
```

Type:

> "I'd like to leave my number"

then the digits, with a real pause in the middle if you're on the mic, then:

> "Okay, bye!"

The agent says goodbye, `[hang up] the agent said goodbye` prints, and the program exits on its own.

## Stuck?

| You see | What's happening | Fix |
|---|---|---|
| `FAIL  TODO 4: your program hung up before the agent asked for end_call. Close only after answering end_call`, or the call ends right after the greeting in `make run 01` | `agent.close()` runs on every `AgentAudioDone`. | Close only when a hang-up is pending (TODO 4). |
| `FAIL  TODO 4: after answering end_call, close the connection when the next AgentAudioDone arrives (the agent never hangs up by itself)`, or the goodbye gets cut off | You closed on the `end_call` request, or never closed. | Answer the request, wait for the next `AgentAudioDone`, then close. |
| `FAIL  TODO 3: when a FunctionCallRequest asks for end_call, send a FunctionCallResponse with the same id and name "end_call"` | No response, or one without the request's `id`. | Reply with the request's `id` and the name `end_call` (TODO 3). |
| `FAIL  TODO 2: give end_call a description that says when to call it (a sentence)` | `END_CALL`'s `description` is still `""`, or shorter than a sentence (10 characters). | Write the sentence (TODO 2). |
| `FAIL  TODO 1: add agent.think_live.provider: type "deepgram", version "v1", agent_backchannel_sensitivity (0 to 1), presence_check_interval_ms and presence_check_max_count` | The timing block is missing or incomplete. | Uncomment the block at TODO 1 (the shape is under What you're building). |
| The goodbye plays and the program never exits | The model said goodbye before it called `end_call`, so no `AgentAudioDone` follows your pending hang-up. | Ctrl-D (or Ctrl-C) for now; the safety-net timer under Going further is the fix. |
| `UNPARSABLE_CLIENT_MESSAGE` in answer to your Settings | Your Deepgram project has no `timing` ([Troubleshooting](../../docs/troubleshooting.md) has the row; [Errors and warnings](https://developers.deepgram.com/docs/voice-agent-errors-warnings) has the agent's error and warning codes). | Finish with `make check 01`, or use a workshop token, or a project that has `timing`. |
| `FAIL  TODO 3: your program answered end_call with a FunctionCallResponse` or `FAIL  TODO 4: your program hung up after answering end_call` in `make live 01` | The real agent asked for `end_call`; your program didn't answer, or answered and never closed. | TODO 3 and TODO 4, as in the rows above; `make check 01` shows the same two with a recorded call. |

<details>
<summary>Python</summary>

| You see | What's happening | Fix |
|---|---|---|
| `RuntimeWarning: coroutine 'Agent.function_call_response' was never awaited` (or `'Agent.close'`) at the bottom of the output, under pytest's `warnings summary`, with a `FAIL  TODO 3:` or `TODO 4:` line above | The call ran without `await`, so nothing was sent; the `[hang up]` line may still print. | Put `await` in front of the `agent.` call: `await agent.function_call_response(...)`, `await agent.close()`. |

</details>

<details>
<summary>TypeScript</summary>

| You see | What's happening | Fix |
|---|---|---|
| `error TS18046: 'event.functions' is of type 'unknown'.` (one line per place you read it) or `error TS2488: Type '{}' must have a '[Symbol.iterator]()' method that returns an iterator.`, under `FAIL  TypeScript (tsc) found type errors in typescript/missions/01-let-me-finish/start.ts:` | You read `event.functions` outside the pre-written loop (`.length`, `[0]`, or a loop of your own): it is typed `unknown`, and `unknown ?? []` is typed `{}`, which cannot be looped either (the replay passed above: tsx strips types, tsc does not). The line number tsc prints is where you read it. | Read the request through the pre-written loop at TODO 3: it carries the one cast the type-error line's "unless the mission's brief shows one" means (`event.functions as FunctionRequest[] \| undefined`). |

</details>

Truly stuck? The reference answer is beside your start file (your language's block under Do this names it). Reading it is part of the workshop, so open it when you need it; `make check 01 MISSION_TARGET=solution` runs it.

Anything else is in the README's [Troubleshooting](../../README.md#troubleshooting), which points at your language's page.

## Check yourself

The `end_call` request has arrived and you have answered it. Why wait for `AgentAudioDone` before `agent.close()`, and why not any `AgentAudioDone`?

<details>
<summary>Answer</summary>

The request arrives before the agent has said goodbye; closing then cuts the goodbye off. `AgentAudioDone` means the goodbye finished playing. The greeting sends an `AgentAudioDone` too, so close only when a hang-up is pending.

</details>

## Going further

Everything here runs live (`make run 01`), so it needs your key or a workshop token in `.env`; the items marked microphone need a spoken turn too.

- **Backchannel at 0 (microphone).** Set `BACKCHANNEL = 0`, then read a phone number out loud with a real pause in the middle: three digits, a breath, four more. Then try 0.3 and 0.8. Backchannels need audio, so this needs your microphone (your language's block below says how; Docker and Codespaces have no microphone, so there you type your turns). Typed lines never get a backchannel.
- **Say nothing.** Leave the call silent and count the seconds until it asks whether you're still there, and how many times it asks. Then decide what your code should do after the last presence check: the agent won't hang up for you.
- **A safety net.** If the model says goodbye before it calls `end_call`, no more audio may follow. Your program then waits for an `AgentAudioDone` that never comes. Add a timer that hangs up a few seconds after the response anyway.

<details>
<summary>Python</summary>

Python only: `make run 01 MIC=1` (headphones on, or the agent hears itself through your speakers).

</details>

<details>
<summary>TypeScript</summary>

This one is heard in the Python track; the check is the proof. Type your turns here.

</details>

<details>
<summary>Java</summary>

This one is heard in the Python track; the check is the proof. Type your turns here.

</details>
