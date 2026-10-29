# Contributing

Thanks for building on the workshop. Two kinds of contribution fit this repo best:

- **[Write mission 07](#write-mission-07)**, or any new mission: one more layer of a voice agent, in every language, with a check.
- **[Add your framework](#add-your-framework)**: the missions in another language or framework, checked by the same harness.

Fixes to the briefs, helpers and checks are welcome too. For anything bigger than a fix, open an issue first, so we can agree on the shape before you build it.

## Write mission 07

Mission 00 (`first-words`) is the reference: copy its files, number yours 07 (or the next free number), and follow the same shape. A mission is done when `make ci` passes and `make live NN` passes in every language against the endpoint you test on. A good mission adds one idea a person can hear: a new event to handle, a new message to send, a setting that changes the conversation.

## Rules

- **Stay inside your folders.** A mission owns `missions/NN-name/`, `fixtures/NN-name/`, `python/missions/NN-name/`, `typescript/missions/NN-name/` and `java/missions/mNN_name/`. `python/agent/`, `typescript/src/`, `java/src/` and `tools/replay-server/` are shared by every mission, so a change there goes in its own pull request, with an issue first.
- **No SDK imports in missions.** Mission code imports only from `agent.common` (Python), `../../src/common.js` (TypeScript) or the `agent` package (Java, beside Jackson's JSON types and the JDK; never `com.deepgram`). Every SDK touchpoint lives in those helpers.
- **Same exercise in every language.** Same TODO numbers, same constants, same behavior. The check is shared, so it can't tell them apart.
- **Names.** Use real wire field and event names (`FrustrationDetected`, `languages`). In prose, name features by their keys: `timing`, `thinking`, `multi_stt`, `multi_tts`. `make names` checks every tracked file against a list of names the maintainers keep out of the repo (see [Running](#running)).
- **No hosts or keys in the repo.** Code, fixtures, docs and CI never name a non-production endpoint. Pass test endpoints through `DEEPGRAM_AGENT_URL` at run time. Keys only ever come from the environment.
- **Confirm what you write** against the API or its docs ([docs index](https://developers.deepgram.com/llms.txt)). Put open questions in an issue: start, solution, check and helper files, fixtures and READMEs (HTML comments included) carry finished text only.
- **Say whether the mission runs on an attendee's own key** at the top of its README. A feature a Deepgram project can't use comes back as `UNPARSABLE_CLIENT_MESSAGE`.

## Files

```text
missions/NN-name/README.md                 brief, own-key status, TODOs, make commands
docs/<language>.md                         the language's setup page: tools, first check, Docker (one per language)
missions/NN-name/check.mjs                 the checks, shared by every language
fixtures/NN-name/<scenario>.jsonl          one recorded conversation per replay scenario
python/missions/NN-name/start.py           attendee's file: works, but with TODOs left
python/missions/NN-name/solution.py        reference answer
python/missions/NN-name/test_NN.py         copy from 00 unchanged
typescript/missions/NN-name/start.ts       same as start.py
typescript/missions/NN-name/solution.ts    same as solution.py
typescript/missions/NN-name/NN.test.ts     copy from 00, change the describe() name
java/missions/mNN_name/Start.java          same as start.py, in package mNN_name
java/missions/mNN_name/Solution.java       same as solution.py
```

`start` must run, connect and fail its check with one clear failure per TODO. `make ci-starts` enforces that it fails. `solution` must pass.

Mark each TODO in the start file with a `# TODO n:` (Python) or `// TODO n:` (TypeScript and Java) comment, and start each check line about it with `TODO n:`. A failed check then names the start file and the line of the first failing TODO, and in TypeScript its code frame shows that line, not the test file.

## The mission module

Every language gives `common` the same two things. `common` handles the rest: it connects, sends your Settings when `Welcome` arrives, prints the transcript, sends typed lines as user turns, sends KeepAlive and saves the agent's audio.

Python:

```python
from agent.common import Agent, Event, run

def build_settings() -> dict: ...            # the Settings JSON, without "type"
async def on_event(agent: Agent, event: Event) -> None: ...   # every event, as a dict

if __name__ == "__main__":
    run(build_settings, on_event)
```

TypeScript:

```ts
import { isMain, run, type Agent, type AgentEvent, type Settings } from '../../src/common.js';

export function buildSettings(): Settings { ... }
export async function onEvent(agent: Agent, event: AgentEvent): Promise<void> { ... }

if (isMain(import.meta.url)) await run({ buildSettings, onEvent });
```

Java:

```java
public class Start implements Mission {
    public ObjectNode buildSettings() { ... }                 // the Settings JSON, without "type"
    public void onEvent(Agent agent, Event event) { ... }     // every event, as wire JSON

    public static void main(String[] args) {
        Common.run(new Start(), args);
    }
}
```

Events are plain wire JSON in every language, including event types the SDK doesn't model. Compare on `event["type"]` / `event.type` / `event.type()`.

### What Agent can send

| Python | TypeScript | Java | Wire message |
|---|---|---|---|
| `await agent.update_prompt(text)` | `agent.updatePrompt(text)` | `agent.updatePrompt(text)` | `UpdatePrompt` |
| `await agent.update_speak(speak)` | `agent.updateSpeak(speak)` | `agent.updateSpeak(speak)` | `UpdateSpeak` |
| `await agent.update_think(think)` | `agent.updateThink(think)` | `agent.updateThink(think)` | `UpdateThink` |
| `await agent.inject_agent_message(text, behavior=None)` | `agent.injectAgentMessage(text, behavior?)` | `agent.injectAgentMessage(text)`, `(text, behavior)` | `InjectAgentMessage` |
| `await agent.inject_user_message(text)` | `agent.injectUserMessage(text)` | `agent.injectUserMessage(text)` | `InjectUserMessage` |
| `await agent.function_call_response(id, name, content)` | `agent.functionCallResponse(id, name, content)` | `agent.functionCallResponse(id, name, content)` | `FunctionCallResponse` |
| `await agent.keep_alive()` | `agent.keepAlive()` | `agent.keepAlive()` | `KeepAlive` |
| `await agent.send_audio(chunk)` | `agent.sendAudio(chunk)` | `agent.sendAudio(chunk)` | binary audio |
| `await agent.send_raw(dict)` | `agent.sendRaw(obj)` | `agent.sendRaw(objectNode)` | anything, as is |
| `await agent.close()` | `agent.close()` | `agent.close()` | hang up; `run` returns |

`agent.settings` holds the Settings you sent, and `agent.ready` tells you whether `SettingsApplied` has arrived. After the call, `agent.close_code` / `agent.closeCode` says how the connection closed (1006: no close frame, the network dropped), and `agent.hung_up` / `agent.hungUp` whether your program hung up (the same names in Java). `run_resilient` / `runResilient` reads both to decide whether to reconnect.

`UpdatePrompt` adds to the prompt the agent already has: send only the new lines, and the Settings prompt and any earlier updates stay in force. A mission that changes the prompt mid-call never resends its rules.

**Fields the SDK doesn't model.** TypeScript passes any JSON through: cast with `as Settings`. Python validates each message against the SDK's models and keeps unknown *keys*, but rejects unknown *values* in a typed union (for example a provider `type` newer than the SDK). When that happens, `common.py` prints a one-line note and sends the same JSON with `send_raw`. Java's `Agent` does the same for any message its SDK types can't carry unchanged.

**Private SDK touchpoints.** `common.py` uses two, both documented in the file: `_send`, for `send_raw` (it calls a public `send_raw` instead when the SDK has one), and `_websocket`, for `close()` when it runs outside `on_event`. That one is a temporary workaround for the pinned `deepgram-sdk` 7.12.0, which has no public close on its async agent socket; it lives in `close_sdk_socket()` alone and uses a public `close()` once the SDK has one. The TypeScript helper uses one: `_ws`, the `ws` socket under the SDK's, for a ping every 20 s (the pinned @deepgram/sdk 5.14.0 socket has no ping). It lives in `rawSocket()` in `common.ts` alone, and a silent-server test in `common.test.ts` fails if the SDK renames it.

## check.mjs

```js
export default {
  replay: [
    {
      name: 'greeting',              // scenario name, shown in test output
      fixture: 'greeting.jsonl',     // file in fixtures/NN-name/
      assert(s, t) { ... },          // s: Session, t: assertions
    },
  ],
  live: {
    timeoutMs: 20000,                                   // fail if `until` never holds
    script: [{ after: 'SettingsApplied', send: { type: 'InjectUserMessage', content: 'bye' }, delay_ms: 500 }],
    until: (s) => s.agentLines.length > 0,              // close the call early once true
    assert(s, t) { ... },
  },
};
```

`script` lets the live check play the caller. Each step fires once, when a server frame of type `after` arrives, waits `delay_ms`, then does one thing:

| Field | What |
|---|---|
| `after` | server frame type that triggers the step |
| `nth` | fire on the nth frame of that type, not the first (default 1). `{ after: 'AgentAudioDone', nth: 2 }` waits until the agent has finished its second reply, so a question never talks over an answer. Prefer this to long fixed delays |
| `delay_ms` | pause after the trigger (default 0) |
| `send` | a JSON frame to send upstream, for example an `InjectUserMessage` |
| `send_audio` | a WAV file to stream upstream instead, path relative to the project root (for example `fixtures/audio/02-annoyed-1.wav`). Mono 16-bit PCM whose rate matches the program's `audio.input.sample_rate`. The harness streams it in real time, in 20 ms chunks, like a microphone |
| `silence_ms` | with `send_audio`: silence streamed after the clip so the agent sees the turn end (default 2000) |

Give each step exactly one of `send` and `send_audio`. Clips play one after another, never on top of each other. What the harness sends is not in `s.sent`; it shows in `s.events` with `dir: 'harness'`.

Recorded callers live in `fixtures/audio/` (see its README for how they were made). A check that has a typed script and an audio one picks the audio one when `LIVE_AUDIO=1` is set (`make live 02 LIVE_AUDIO=1`); read `process.env.LIVE_AUDIO` at the top of `check.mjs`. Keep the typed path as the default: it's faster and doesn't depend on how the listener hears a synthetic voice.

Write every assertion message for the attendee. Say what to change ("TODO 2: answer end_call, then close the connection"), not what the harness saw. Start each TODO check with `TODO n:` so it matches the README.

### Session (`s`)

| Member | What |
|---|---|
| `s.sent` | JSON frames your program sent, in order |
| `s.received` | JSON frames the server sent, in order |
| `s.settings` | the first Settings frame, or null |
| `s.sentOfType(type)`, `s.receivedOfType(type)` | filtered frames |
| `s.agentLines`, `s.userLines` | `content` of assistant and user `ConversationText`, in order |
| `s.events` | the full timeline: `{ dir: 'client' \| 'server' \| 'harness', at, frame }`, `{ dir, at, bytes }` for audio, or `{ dir: 'harness', at, audio, bytes }` when a live script starts a clip |
| `s.indexOf(dir, type, from?)` | position in `events` of the first matching frame, for order checks |
| `s.audioBytesSent`, `s.audioBytesReceived` | audio totals |
| `s.close` | `{ by: 'client' \| 'server' \| 'harness', code, reason, at }` |
| `s.stalled` | set when a fixture `expect` step timed out; the harness already reports it |

### Assertions (`t`)

Each call records a result and returns whether it passed, so one run reports every problem at once.

| Call | Passes when |
|---|---|
| `t.ok(cond, msg)` | `cond` is truthy |
| `t.equal(actual, expected, msg)` | deep equal (JSON) |
| `t.match(str, regex, msg)` | `str` is a string matching `regex` |
| `t.has(obj, 'a.b.c', msg)` | the path exists and isn't null or empty; returns the value |
| `t.before(i, j, msg)` | both indexes exist and `i < j` (use with `s.indexOf`) |
| `t.fail(msg)` | never |
| `t.get(obj, 'a.b.c')` | (helper, no assertion) reads a path |

Example: the filler line goes out before the tool result.

```js
t.before(s.indexOf('client', 'InjectAgentMessage'), s.indexOf('client', 'FunctionCallResponse'),
  'TODO 2: send the filler line before the tool result');
```

## Fixtures

A fixture is JSON Lines: one step per line, run top to bottom against one client. Blank lines and lines starting with `//` are skipped.

| Step | Effect |
|---|---|
| `{"recv": {...}}` | the server sends this JSON frame |
| `{"recv_binary": {"bytes": 4800}}` | the server sends that many bytes of silence (agent audio) |
| `{"expect": "Settings", "timeout_ms": 5000}` | wait until the client sends a frame of that type; frames in between are kept, not matched |
| `{"expect": "close"}` | wait until the client closes the connection |
| `{"wait_ms": 200}` | pause |
| `{"close": {"code": 1000, "reason": "..."}}` | the server closes the connection |
| `{"meta": {...}}`, `{"note": "..."}` | ignored; for humans |

Strings inside `recv` frames can use `{{settings.<path>}}`, filled from the client's Settings, for example `"content": "{{settings.agent.greeting}}"`. A string that is nothing but the template takes the value as is, so `"languages_hinted": "{{settings.agent.listen.provider.language_hints}}"` gives a list, and an empty list stays `[]`. A template inside a longer string is spliced in as text, with lists and objects written as JSON (`"hints: []"`, never `"hints: "`). A path the Settings don't have gives `""`. If the fixture ends without `close`, the harness waits 300 ms and then closes. An `expect` that times out stops the replay and fails with "Your program never sent X".

Every replay should start with `Welcome` and `{"expect": "Settings"}`.

### Recording a fixture

Record from a live run, then edit it:

```sh
cd python
MISSION_TARGET=solution RECORD_FIXTURE=../fixtures/NN-name/raw.jsonl \
  DEEPGRAM_AGENT_URL=<endpoint> uv run pytest -q -m live missions/NN-name
```

The recorder turns your program's frames into `expect` steps (type only, so prompts never land in the file), server frames into `recv`, runs of audio into one `recv_binary`, and gaps of 250 ms or more into `wait_ms`. It never sees keys or headers, and it doesn't write the endpoint host. Before committing: zero `request_id`, swap echoed values for `{{settings...}}` templates, trim audio you don't need, and add the events you can't trigger live (for example `FrustrationDetected`) by hand.

## Running

```sh
make check NN SDK=all                # your start files, every language you have installed
make check NN MISSION_TARGET=solution SDK=all
make live NN SDK=py                  # needs DEEPGRAM_API_KEY; DEEPGRAM_AGENT_URL picks the endpoint
make live NN LIVE_AUDIO=1 SDK=all    # 02 and 04: play recorded callers instead of typed turns
make live-all LIVE_SKIP="01 02" SDK=all  # every live check except the listed missions
make ci                              # harness self-test, hint and Makefile tests, helper unit tests, every solution passes, every start fails on its TODOs
FORBIDDEN_TERMS="a,b" make names      # the name scan over every tracked file
```

**Other platforms.** CI runs a Windows-style clone (`core.autocrlf=true`), Fedora, Docker Engine and WSL beside the offline matrix. `.gitattributes` keeps every text file LF in every checkout, and `make make-test` proves it with a real `core.autocrlf=true` clone. On native Windows (`OS=Windows_NT`), every make goal prints the line pointing at Codespaces or WSL; `ALLOW_WINDOWS=1` runs the Makefile anyway, for testing make under Git Bash.

**The name scan.** `make names` reads a comma-separated list of names from `FORBIDDEN_TERMS` and fails on any tracked file that names one (case, spaces, hyphens and underscores aside, even inside a longer word), including a term wrapped onto the next line or split by string concatenation. It prints file and line only, never the term. In CI the list comes from the `FORBIDDEN_TERMS` repository secret: an empty list fails the job, and pull requests from forks, which get no secrets, skip it. Run locally with the list unset, it says so and passes.

For maintainers: add the `FORBIDDEN_TERMS` repository secret before the first push.

**Through the workshop proxy.** With both `WORKSHOP_URL` and `WORKSHOP_TOKEN` set (and no `DEEPGRAM_AGENT_URL`), `common` uses the token even when a `DEEPGRAM_API_KEY` is set too, and prints one `[credentials]` line saying so. It connects to `WORKSHOP_URL/<mission folder>` (the SDK adds `/v1/agent/converse`) with the token as a bearer token, and the live harness relays to the same place. `DEEPGRAM_AGENT_URL` still wins when it is set, but only alongside your own key: with a token and no key, both `common` and the harness stop with a setup error, so the token only ever goes to the workshop proxy. When the proxy can't take a conversation it sends one `Error` before `Welcome` (`TALK_UNCONFIGURED`, `TALK_PAUSED`, `ONLINE_FULL`, `LIVE_CLOSED`) and closes 1013; a staff pause mid-run is a `TALK_PAUSED` `Warning`, then close 1000. `common` prints the proxy's line and stops (exit 1 for a refusal, 0 for a pause), and a live check fails with that line. The mission folder in the path is how the proxy files the conversation under the right mission on the player's map, so keep the `NN-name` folder names. Through the proxy, Settings go through the workshop's allow-lists (listen models, LLMs, voices) and feature flags: a check that needs a value outside them can't pass there, so say so in the mission README.

`live-all` runs every mission's live check and reports all failures at the end. `LIVE_SKIP` takes mission numbers or folder names, separated by spaces or commas. Missions 01 and 02 need a key from a Deepgram project that can use the `timing` feature (or the workshop proxy); with any other key, skip them: `LIVE_SKIP="01 02"`. The nightly CI live job runs `make live-all`. It reads `DEEPGRAM_API_KEY` and the optional `DEEPGRAM_AGENT_URL` from repository secrets, so Actions masks both in the logs, and `LIVE_SKIP` and `LIVE_AUDIO` from repository variables.

The harness on its own, for debugging (`--dump` writes the whole session as JSON):

```sh
node tools/replay-server/harness.mjs list NN
node tools/replay-server/harness.mjs replay NN <scenario> --dump /tmp/session.json
```

## Add your framework

The checks don't care what language your program is written in. The harness in `tools/replay-server/` is a WebSocket server that plays the agent: your program connects to it instead of Deepgram, and the harness checks what your program sent. So a new language, or a framework on top of one (FastAPI, Next.js, a Pipecat or LiveKit pipeline), joins in three steps:

1. **A helper module**, like `python/agent/common.py`, that holds every SDK call: connect, send Settings when `Welcome` arrives, hand each event to the mission as wire JSON, send `KeepAlive`, save the agent's audio, and the `Agent` senders in [What Agent can send](#what-agent-can-send). Read the agent endpoint from `DEEPGRAM_AGENT_URL` and the key from `DEEPGRAM_API_KEY`. Check `DEEPGRAM_AGENT_URL` and `WORKSHOP_URL` with the address pattern in `common.py` before connecting, and have your unit tests read `tools/parity/addresses.json`, as Python, TypeScript, Java and the harness do.
2. **The missions**, in `<language>/missions/NN-name/start.*` and `solution.*`, with the same TODO numbers, constants and behavior as Python. The checks are shared, so they can't tell the languages apart.
3. **A test hook** that runs each mission against the harness. Start `node tools/replay-server/harness.mjs replay NN <scenario>`, wait for the `READY <ws url>` line, point your program at that URL with any non-empty key, and read the `VERDICT <json>` line it prints last (exit code 0 passes). `node tools/replay-server/harness.mjs list NN` lists the scenarios. `python/agent/testing.py` and `typescript/src/testing.ts` are two working examples.

Then add one language block to the `Makefile`, next to the others: its id in `LANGS`, and `NAME_<id>`, `ALIASES_<id>` (the words `make use` and `SDK=` accept), `DETECT_<id>` (a command that succeeds when its tool is installed), `TOOL_<id>` and `HOW_<id>` (the tool and how to install it), `FILE_<id>` (the file a mission's check works on), `CHECK_<id>`, `LIVE_<id>`, `RUN_<id>`, `UNIT_<id>` and `UNITDIR_<id>`, plus `MIC_<id>` if it can use the microphone and `POSTCHECK_<id>` for a step after each check (TypeScript's `tsc`), and a `setup-<id>` target. The pick line and `make use`'s lines are built from `LISTED_LANGS` and `NAME_<id>`, and `tools/make/make.test.mjs` reads those from the Makefile, so its tests follow the new block; run `make make-test` to see. A language that has some missions so far sets `MISSIONS_<id>` to them: the others stop with one line naming a language that has them, and `make ci` and `live-all` skip them. Keep it out of `LISTED_LANGS` until it has every mission; `make use <id>` and `SDK=<id>` work either way. Add the id to `AUTO_LANGS` only if `make setup`, `make ci` and `SDK=all` should take it up whenever its tool is installed; otherwise it runs only when asked for by name (`make use <id>`, `SDK=<id>`). Outside the blocks, a language is named only by the `setup-<id>` targets, `typecheck` (the whole TypeScript project) and the help text at the top of the Makefile. Then add it to the CI matrix, and a line to the README. Pin the SDK version exactly, as the others do, so every check runs against a known release.

Java is the worked example of all of this: its block in the `Makefile` (in `LISTED_LANGS` and outside `AUTO_LANGS`, so it runs when picked; `MISSIONS_java` matches every mission), `java/src/main/java/agent/` (the helper module, with `Testing.java` and `Check.java` as the test hook), `java/mission.sh` (setup, check, run and unit), and `MissionsLayoutTest`, which fails when a Java start file's TODO numbers differ from Python's. Check it with `make check NN SDK=java` and `make ci SDK=java`.
