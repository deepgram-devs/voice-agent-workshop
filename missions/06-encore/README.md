# 06 Encore (bonus)

**Goal:** push the voice's Speed and Expressivity until your agent does an impression: a hushed nature documentary narrator, a sports announcer in the final ten seconds, whatever you write.

**You'll learn**

- The two fields that tune a Flux voice's performance, `speed` and `expressivity`, and their ranges
- Which of the two you can change mid-call, and which holds for the whole call
- How to prove the settings landed (the checks) and, if you like, hear the difference between two runs

**Layer:** voice.

## Before you start

- **Runs on your own key:** yes. Speed and Expressivity are fields of a Flux voice (`version: "v2"`), on any Deepgram project.
- Your start file open in your editor: `python/missions/06-encore/start.py`, `typescript/missions/06-encore/start.ts` or `java/missions/m06_encore/Start.java`. The rest of this page calls it your start file.
- Something to play a `.wav` with: this mission is about how the voice sounds. In Docker or Codespaces the file is how you listen ([README: Hear your agent](../../README.md#hear-your-agent)).

## What you're building

Mission 00 picked a voice. This one tunes how it performs. Both knobs sit inside `agent.speak.provider`, next to the voice ([TTS controls](https://developers.deepgram.com/docs/voice-agent-tts-controls) has both):

```json
{ "speak": { "provider": { "type": "deepgram", "model": "flux-hannah-en", "version": "v2", "speed": 0.9, "expressivity": 1 } } }
```

| Field | Range | What it does |
|---|---|---|
| `speed` | 0.85 to 1.15 in steps of 0.05: this mission's range, and the check holds you to it. The API takes 0.5 to 1.5. 1 is normal | How fast it talks. Slow for gravitas, fast for panic |
| `expressivity` | whole numbers from -2 to 2. 0 is the voice's own delivery | How much it leans into the words, from calm (-2) to animated (2) |

Expressivity locks in when the voice starts and holds for the whole call, so to try a new value, hang up and run again. It's a beta setting ([Expressivity](https://developers.deepgram.com/docs/tts-expressivity)): 0 is the production default and other values are for auditioning, so listen before you ship one.

## Do this

Each TODO sits at a `TODO n:` comment in your start file, with the exact call to make. All three are constants near the top of the file.

1. **Ask for a performance** (`PROMPT`). Give it a scene as well as a persona: who is talking, and what they narrate. For example: *You are a nature documentary narrator describing whatever the listener says as if it were a rare animal in the wild. Hushed, awed, one or two sentences a turn.*
2. **Change the speed** (`SPEED`). Anything other than 1, from 0.85 to 1.15 in steps of 0.05: this mission's range, and the check holds you to it. The API takes 0.5 to 1.5.
3. **Change the expressivity** (`EXPRESSIVITY`). A whole number from -2 to 2, other than 0.

Keep a Flux voice (`flux-...`, `version: "v2"`): Speed and Expressivity in this form belong to Flux voices.

<details>
<summary>Python</summary>

- Your start file: [`python/missions/06-encore/start.py`](../../python/missions/06-encore/start.py); the reference answer is `solution.py` beside it.

</details>

<details>
<summary>TypeScript</summary>

- Your start file: [`typescript/missions/06-encore/start.ts`](../../typescript/missions/06-encore/start.ts); the reference answer is `solution.ts` beside it.

</details>

<details>
<summary>Java</summary>

- Your start file: [`java/missions/m06_encore/Start.java`](../../java/missions/m06_encore/Start.java); the reference answer is `Solution.java` beside it.

</details>

## Verify

**Run the checks.**

```sh
make check 06             # from the project folder. Offline: checks your Settings. No key
make live 06              # live: the agent accepts your voice settings and performs a line
# in Docker: docker compose run --rm workshop make check 06   (workshop-java in the Java service)
# in Docker: docker compose run --rm workshop make live 06   (workshop-java in the Java service)
```

The offline check passes when your Settings carry your own prompt and a Flux voice. The speed has to be other than 1 and the expressivity other than 0, both inside their ranges. The live check types one line for the agent to narrate. It passes when the real agent accepts your Settings, sends no error, and answers with audio.

**Talk to it.** Needs your key or a workshop token in `.env` ([README: Your API key](../../README.md#your-api-key)).

```sh
make run 06               # from the project folder, in the language you picked with make use
# in Docker: docker compose run --rm workshop make run 06   (workshop-java in the Java service)
```

Type something for it to narrate:

> "A pigeon has landed on the cafe table and is eyeing my croissant."

The agent narrates it in the voice, speed and expressivity you set. Press Ctrl-D (or Ctrl-C) to hang up. The checks are the proof here. The offline check reads your Settings and the live check reads the agent's answer, so you can finish this mission without hearing a thing. Listening is the fun part, and optional. Play `out/last-call.wav` on your machine; in Docker or Codespaces you hear nothing during the run, and the file is how you listen. To compare two settings, copy the file first (`cp out/last-call.wav out/take-1.wav`; in PowerShell, `copy out\last-call.wav out\take-1.wav`). Then change `EXPRESSIVITY`, run it again with the same line, and play both: each run writes a new `last-call.wav`.

## Stuck?

| You see | What's happening | Fix |
|---|---|---|
| `FAIL  TODO 1: the prompt asks for a performance of your own, not the starter one` or `FAIL  TODO 1: the prompt is at least a sentence (20+ characters)` | `PROMPT` is still the starter's, or shorter than a sentence. | Give it a scene and a persona (TODO 1). |
| `FAIL  TODO 2: set agent.speak.provider.speed to something other than 1` | `SPEED` is still 1. | 0.9 or 1.1, say (TODO 2). |
| `FAIL  TODO 2: speed is from 0.85 to 1.15, in steps of 0.05` | Off the range, or off the 0.05 steps (1.03, say). 0.85 to 1.15 in steps of 0.05: this mission's range, and the check holds you to it. The API takes 0.5 to 1.5. | Same fix. |
| `FAIL  TODO 3: set agent.speak.provider.expressivity to a whole number other than 0` | `EXPRESSIVITY` is still 0, or a fraction (then the next line prints too). | 1 or -1, say (TODO 3). |
| `FAIL  TODO 3: expressivity is a whole number from -2 to 2` | Off the range, or a fraction (1.5, say; the line above prints with it). | Same fix. |
| `FAIL  Keep a Flux voice (a flux-... model with version "v2"): Speed and Expressivity in this form belong to Flux voices` | An Aura-2 voice. With `"version": "v2"` still on the line, mission 00's Aura line (`agent.speak.provider: aura-2-thalia-en is an Aura voice, so leave version out ...`) prints above this one as well. | Keep a `flux-...` voice with `version: "v2"`. |
| You changed `EXPRESSIVITY` and the run sounds the same | Expressivity locks in when the voice starts and holds for the whole call. | Hang up and run again. |
| Both `.wav` files sound the same | The second run wrote over `out/last-call.wav`. | Copy the first file before the second run: `cp out/last-call.wav out/take-1.wav`. |

<details>
<summary>Python</summary>

| You see | What's happening | Fix |
|---|---|---|
| `[note] Settings sent as raw JSON: this SDK release has no field for part of it (the check reads it the same)`, the first line of pytest's `Captured stdout call` under two `FAIL  TODO 3` lines, or, on a `make run 06` that connects, the line between `Running your Python file:` and `[ready]` | `EXPRESSIVITY` is written as a decimal (`1.5`, or `1.0`): the pinned SDK's field takes a whole number and nothing else, so the helpers send your Settings as raw JSON instead. The check then reads the JSON: `1.5` fails TODO 3 (the two lines above), `1.0` passes it. `SPEED` never prints this line. | Write a whole number (`1`, not `1.0` or `1.5`); the line goes with it. |

</details>

<details>
<summary>TypeScript</summary>

| You see | What's happening | Fix |
|---|---|---|
| Two `FAIL  TODO 2` lines (TODO 3's too while it is `0`), `Your file:`, its code frame and vitest's summary, then `FAIL  TypeScript (tsc) ...`, the type-error line, and `missions/06-encore/start.ts(19,7): error TS2322: Type 'string' is not assignable to type 'number'.` (19 in the unedited file) | `SPEED` (or `EXPRESSIVITY`, line 23) is a string: `'0.9'` in quotes. The constant carries a type (`: number`), so tsc points at the value on its own line. The type-error line is `Your file has a TypeScript type error ... a cast is not the fix, unless the mission's brief shows one.` | Write the number without quotes; never a cast. Then the command the line names (in Docker: `docker compose run --rm workshop make check 06`). |

</details>

<details>
<summary>Java</summary>

| You see | What's happening | Fix |
|---|---|---|
| `java/missions/m06_encore/Start.java:30: error: incompatible types: possible lossy conversion from double to int`, then `Your Java file doesn't compile: fix the first error above (java/missions/m06_encore/Start.java:30), then run make check 06 again.` (30 is the unedited file's line) | A fraction in `EXPRESSIVITY`: in Java it never reaches the check, the compiler stops first. | A whole number from -2 to 2, other than 0, then the command the line names (in Docker: `docker compose run --rm workshop-java make check 06`). |

</details>

Truly stuck? The reference answer is beside your start file (your language's block under Do this names it). Reading it is part of the workshop, so open it when you need it; `make check 06 MISSION_TARGET=solution` runs it.

Anything else is in the README's [Troubleshooting](../../README.md#troubleshooting), which points at your language's page.

## Check yourself

You send `UpdateSpeak` mid-call with the same voice and `expressivity: 2`. What changes?

<details>
<summary>Answer</summary>

The voice can change from the next reply; expressivity stays at the value the call started with. For a new expressivity, hang up and run again.

</details>

## Going further

Everything here runs live (`make run 06`), so it needs your key or a workshop token in `.env`.

- Swap the voice mid-call without hanging up: send one `UpdateSpeak` (the call is in the block below) with a new `provider`, for example after the second turn. The conversation carries on in the new voice; Expressivity stays at the value the call started with.
- Add to the act mid-call with one `UpdatePrompt` (the call is in the block below). `UpdatePrompt` adds to the prompt the agent already has: send only the new lines, and the Settings prompt and any earlier updates stay in force.

<details>
<summary>Python</summary>

`await agent.update_speak(...)`, `await agent.update_prompt(...)`

</details>

<details>
<summary>TypeScript</summary>

`agent.updateSpeak(...)`, `agent.updatePrompt(...)`

</details>

<details>
<summary>Java</summary>

`agent.updateSpeak(...)`, `agent.updatePrompt(...)`

</details>
