# 02 Read the room

**Goal:** an agent that notices a frustrated caller and changes course once, not over and over.

**You'll learn**

- What `FrustrationDetected` carries, and why `count` never resets
- `UpdatePrompt` adds to the prompt; it never replaces it
- The one-recovery rule, and how the offline check proves it

**Layer:** timing.

## Before you start

- **Runs on your own key:** on a Deepgram project that has the `timing` feature. On a project without it, Settings with the block gets `UNPARSABLE_CLIENT_MESSAGE`. In the room, the workshop token covers it; anywhere, `make check 02` runs offline with no key.
- Your start file open in your editor: `python/missions/02-read-the-room/start.py`, `typescript/missions/02-read-the-room/start.ts` or `java/missions/m02_read_the_room/Start.java`. The rest of this page calls it your start file.

## What you're building

With `timing` on, the agent keeps a running count of annoyed turns: you cut it off, repeat yourself, or snap at it. Each time the count goes up, it sends you an event:

```json
{ "type": "FrustrationDetected", "count": 2, "escalated": true }
```

- `count` is cumulative. It counts up for the whole call and doesn't reset.
- `escalated` turns `true` once `count` reaches your `frustration_max_count`. Deepgram changes nothing on its own, so your code decides what happens next.

Your job is the specific change at the limit: one [`UpdatePrompt`](https://developers.deepgram.com/docs/voice-agent-update-prompt) that tells the agent how to recover.

The limit goes in the timing block of Settings, beside `listen`, `think` and `speak`:

```json
"think_live": {
  "provider": { "type": "deepgram", "version": "v1", "frustration_max_count": 2 }
}
```

## Do this

Each TODO sits at a `TODO n:` comment in your start file, with the exact call to make. The start file runs as it is, but it has a bug.

1. **Pick a limit** (`FRUSTRATION_LIMIT`): how many annoyed turns before `escalated` turns true. A whole number from 1 to 5. A bank picks 2. A game picks 5.
2. **Send only the new lines** (`RECOVERY`). `UpdatePrompt` adds to the prompt the agent already has: send only the new lines, and the Settings prompt and any earlier updates stay in force. The start file sends the whole prompt again with the recovery on the end, so the agent ends up with its instructions twice. Keep only the recovery.
3. **Fix the bug in the handler.** The start file sends the recovery on *every* `FrustrationDetected`. So the agent apologizes on every annoyed turn, even before the limit. Send it exactly once, the first time `escalated` is true: the `recovered` flag remembers you've sent it.

`FrustrationDetected` reaches your event handler as a plain object; compare on its type field:

<details>
<summary>Python</summary>

- Your start file: [`python/missions/02-read-the-room/start.py`](../../python/missions/02-read-the-room/start.py); the reference answer is `solution.py` beside it.

`event["type"]`, in `on_event()`.

</details>

<details>
<summary>TypeScript</summary>

- Your start file: [`typescript/missions/02-read-the-room/start.ts`](../../typescript/missions/02-read-the-room/start.ts); the reference answer is `solution.ts` beside it.

`event.type`, in `onEvent()`.

</details>

<details>
<summary>Java</summary>

- Your start file: [`java/missions/m02_read_the_room/Start.java`](../../java/missions/m02_read_the_room/Start.java); the reference answer is `Solution.java` beside it.

`event.type()`, in `onEvent()`.

</details>

## Verify

**`make check 02` is the pass.** Frustration comes from *how* you talk as well as what you say, and typed turns rarely trigger `FrustrationDetected`, so the offline check, with its hand-written events, is where this mission passes or fails:

```sh
make check 02             # from the project folder. Offline: two recorded calls. No key
make live 02              # live: needs `timing` (see the top of this page)
# in Docker: docker compose run --rm workshop make check 02   (workshop-java in the Java service)
# in Docker: docker compose run --rm workshop make live 02   (workshop-java in the Java service)
```

The offline check replays two calls with hand-written `FrustrationDetected` events:

- **three-strikes:** three events. `escalated` turns true on the second and is true again on the third. It passes when your program sends exactly **one** `UpdatePrompt`, after the first escalated event, and that `UpdatePrompt` doesn't repeat your base prompt.
- **never-escalates:** two events, both with `escalated: false`. It passes when your program sends **no** `UpdatePrompt`.

Both read the events your program received and the `UpdatePrompt` frames (the JSON messages on the WebSocket; JSON is the text format they are written in) it sent back, so nothing here is self-reported. Your test runner's summary for two recorded calls is on your language's page (`2 passed`, in its own words).

The live check has the harness type four annoyed turns. It passes when the agent accepts your Settings (timing block included) and answers. If a `FrustrationDetected` arrives, it also checks the one-recovery rule. If none arrives, it says so in its output, and the offline check is your proof for the recovery.

**Talk to it.** Needs your key on a Deepgram project with `timing`, or a workshop token, in `.env` ([README: Your API key](../../README.md#your-api-key)).

```sh
make run 02               # from the project folder, in the language you picked with make use
# in Docker: docker compose run --rm workshop make run 02   (workshop-java in the Java service)
```

Type a line and press Enter; Ctrl-D (or Ctrl-C) hangs up. To hear a recovery land, see Going further.

## Stuck?

| You see | What's happening | Fix |
|---|---|---|
| `FAIL  TODO 3: send exactly one UpdatePrompt for the whole call (you sent N)`, or the agent apologizes on every annoyed turn in `make run 02` | The recovery goes out on every `FrustrationDetected` (N is how many went out). | Send it once, the first time `escalated` is true; the `recovered` flag remembers (TODO 3). |
| `FAIL  TODO 3: wait for the first FrustrationDetected with escalated true before you send the recovery` | The recovery went out on an event with `escalated: false`. | Decide on `escalated`, never on `count`. |
| `FAIL  TODO 3: no UpdatePrompt while escalated is false (you sent N)` (in `never-escalates`) | Same cause, seen from the call that never escalates. | Same fix. |
| `FAIL  TODO 2: UpdatePrompt adds to the prompt the agent already has, so send only the new lines, not the whole prompt again` | `RECOVERY` still holds the whole prompt with the recovery on the end. | Send only the new lines (TODO 2). |
| `FAIL  TODO 1: set frustration_max_count to a whole number from 1 to 5` | `FRUSTRATION_LIMIT` is still the starter's, or outside 1 to 5. | Pick a whole number from 1 to 5 (TODO 1). |
| `FAIL  TODO 2: the recovery says what to do now (20+ characters)` | `RECOVERY` is shorter than a sentence. | Tell the agent what to do now, in a line or two (TODO 2). |
| No `FrustrationDetected` during `make run 02` | Typed turns rarely trigger it. | Expected. Talk with the microphone (Going further says how), or trust the offline check. |
| `UNPARSABLE_CLIENT_MESSAGE` in answer to your Settings | Your Deepgram project has no `timing` ([Troubleshooting](../../docs/troubleshooting.md) has the row). | `make check 02`, a workshop token, or a project with `timing`. |
| `FAIL  TODO 3: send exactly one UpdatePrompt once escalated is true (you sent N)` in `make live 02` | The live call got a `FrustrationDetected` with `escalated: true` and your program sent the recovery more than once, or not at all. | Same as the first row: once, on the first `escalated: true` (TODO 3). |

<details>
<summary>Python</summary>

A fraction (2.5, say) prints the same `FAIL  TODO 1` line.

</details>

<details>
<summary>TypeScript</summary>

A fraction (2.5, say) prints the same `FAIL  TODO 1` line.

</details>

<details>
<summary>Java</summary>

| You see | What's happening | Fix |
|---|---|---|
| `java/missions/m02_read_the_room/Start.java:26: error: incompatible types: double cannot be converted to Integer`, then `Your Java file doesn't compile: fix the first error above (java/missions/m02_read_the_room/Start.java:26), then run make check 02 again.` (26 is the unedited file's line) | A fraction in `FRUSTRATION_LIMIT`: in Java it never reaches the check, the compiler stops first. | Same fix: a whole number from 1 to 5, then the command the line names (in Docker: `docker compose run --rm workshop-java make check 02`). |

</details>

Truly stuck? The reference answer is beside your start file (your language's block under Do this names it). Reading it is part of the workshop, so open it when you need it; `make check 02 MISSION_TARGET=solution` runs it.

Anything else is in the README's [Troubleshooting](../../README.md#troubleshooting), which points at your language's page.

## Check yourself

The third annoyed turn arrives with `escalated: true`, and the second one already did. How many `UpdatePrompt` messages has your program sent so far?

<details>
<summary>Answer</summary>

One, after the second event, the first with `escalated: true`. Without the `recovered` flag you would send it again on the next event that carries `escalated: true`.

</details>

## Going further

Everything here runs live (`make run 02`), so it needs your key or a workshop token in `.env`; hearing a recovery land takes a spoken annoyed turn too.

- **Hear it (microphone).** Talk to it instead of typing (your language's block below says how; Docker and Codespaces have no microphone, so there you type your turns), and get annoyed: cut it off, repeat yourself, snap at it.
- **Recorded callers.** `make live 02 LIVE_AUDIO=1` plays three recorded complaints instead (`fixtures/audio/`), each one after the agent's answer to the last has finished. The agent hears a voice, as it would from a microphone, and the check also wants a user turn transcribed from it. The clips are a synthetic voice, so the words are annoyed but the tone is flat. If they don't trigger `FrustrationDetected`, the check passes on Settings and says so, as under Verify.
- Make the recovery match your product: hand off to a person, repeat back what you have so far, or (for a game) get more dramatic instead of apologizing. `make check 02` reads the new text.
- Watch for `PromptUpdated` after your `UpdatePrompt` and print it, so you can see the recovery land ([Acknowledgements](https://developers.deepgram.com/docs/voice-agent-acknowledgements) has it and its three siblings).

<details>
<summary>Python</summary>

Python only: `make run 02 MIC=1` (headphones on, or the agent hears itself through your speakers).

</details>

<details>
<summary>TypeScript</summary>

This one is heard in the Python track; the check is the proof. Type your turns here.

</details>

<details>
<summary>Java</summary>

This one is heard in the Python track; the check is the proof. Type your turns here.

</details>
