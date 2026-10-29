# 00 First words

**Goal:** an agent that greets you and talks back, with a prompt you wrote and a voice you picked.

**You'll learn**

- The one message that sets up a voice agent, Settings, and its five parts
- Where the prompt, the voice and the greeting live in your code
- What a passing check looks like, offline and live

**Layer:** voice.

## Before you start

- **Runs on your own key:** yes, on any Deepgram project. The offline check needs no key at all.
- `make check 00` has run once and printed `Your file: ...` (your language's page, under Check that it works). If it hasn't, do your language's page first ([README: Pick a language](../../README.md#pick-a-language)).
- Your start file open in your editor: `python/missions/00-first-words/start.py`, `typescript/missions/00-first-words/start.ts` or `java/missions/m00_first_words/Start.java`. The rest of this page calls it your start file.

## What you're building

A voice agent connection is a WebSocket, a network connection that, unlike a normal web request, stays open so both sides can send whenever they like. It carries one message that sets everything up: **Settings**. Your program sends it once, right after the server says [`Welcome`](https://developers.deepgram.com/docs/voice-agent-welcome-message). It holds five parts:

```text
Settings
  audio           the audio format in and out
  agent.listen    hearing: the speech-to-text model
  agent.think     thinking: the language model, and your prompt
  agent.speak     voice: who it sounds like
  agent.greeting  the first line it says, before it hears you
```

The server answers [`SettingsApplied`](https://developers.deepgram.com/docs/voice-agent-setting-applied-message), says the greeting, and from then on every line from either side arrives as a [`ConversationText`](https://developers.deepgram.com/docs/voice-agent-conversation-text) event. That order never changes: `Welcome`, Settings, `SettingsApplied`, then audio and events ([Message flow](https://developers.deepgram.com/docs/voice-agent-message-flow)). [Settings](https://developers.deepgram.com/docs/voice-agent-settings) shows the whole message, and [Configure the Voice Agent](https://developers.deepgram.com/docs/configure-voice-agent) describes every field, with its default where a field has one.

## Do this

Each TODO sits at a `TODO n:` comment in your start file, with the exact call to make. All three are constants near the top of the file.

1. **Write the prompt** (`PROMPT`). Who the agent is, how it talks, and one rule it always follows. For example: *You are Sam, the barista at a tiny cafe. Answer in one short sentence, then ask one question back. Never recommend decaf.*
2. **Pick a voice** (`VOICE`). Anything other than the starter's `flux-hannah-en`: `flux-cliff-en`, `flux-alexis-en`, `flux-rufus-en` or `flux-sienna-en`. One rule: a Flux voice (`flux-...`) keeps the start file's `"version": "v2"`, and an Aura-2 voice (`aura-2-...`, such as `aura-2-thalia-en`) takes no `version`, so delete the field for one of those (your language's block below has the line; the Stuck? table has the check's line for either mistake). [TTS models](https://developers.deepgram.com/docs/voice-agent-tts-models) has the rule and links the voice catalogs.
3. **Add a greeting** (`GREETING`). The first thing it says when you connect.

<details>
<summary>Python</summary>

- Your start file: [`python/missions/00-first-words/start.py`](../../python/missions/00-first-words/start.py); the reference answer is `solution.py` beside it.

The function is `build_settings()`; the `speak` line is `start.py` line 29 in the unedited file (a longer prompt above moves it): `"speak": {"provider": {"type": "deepgram", "model": VOICE, "version": "v2"}},`. For an Aura-2 voice, delete `, "version": "v2"`.

</details>

<details>
<summary>TypeScript</summary>

- Your start file: [`typescript/missions/00-first-words/start.ts`](../../typescript/missions/00-first-words/start.ts); the reference answer is `solution.ts` beside it.

The function is `buildSettings()`; the `speak` line is `start.ts` line 32 in the unedited file (a longer prompt above moves it): `speak: { provider: { type: 'deepgram', model: VOICE, version: 'v2' } },`. For an Aura-2 voice, delete `, version: 'v2'`.

</details>

<details>
<summary>Java</summary>

- Your start file: [`java/missions/m00_first_words/Start.java`](../../java/missions/m00_first_words/Start.java); the reference answer is `Solution.java` beside it.

The function is `buildSettings()`; the `speak` line is `Start.java` line 37 in the unedited file (a longer prompt above moves it): the `"speak", obj("provider", obj("type", "deepgram", "model", VOICE, "version", "v2"))` line. For an Aura-2 voice, delete `, "version", "v2"`.

</details>

## Verify

**Run the checks.**

```sh
make check 00             # from the project folder. Offline: checks your Settings and that the greeting comes back. No key
make live 00              # live: SettingsApplied, then the agent speaks. Needs your key or a workshop token
# in Docker: docker compose run --rm workshop make check 00   (workshop-java in the Java service)
# in Docker: docker compose run --rm workshop make live 00   (workshop-java in the Java service)
```

The offline check passes when Settings is the first message you send, has every layer, and carries your own prompt, a voice other than the default and a greeting. It ends with two lines: `Mission 00 passes its offline check: <your start file>` and the `Next:` line, which spells out `make run 00`, then `make live 00`. In Docker those read `docker compose run --rm workshop make run 00` (`workshop-java` in the Java service).

When the language is not your saved one, the `SDK=` you typed is on the end of both commands in the `Next:` line. Your test runner's summary prints above those two lines (your language's block below gives it). The live check passes when the real agent accepts your Settings and says something.

When both pass, the README's [missions table](../../README.md#missions) has mission 01.

<details>
<summary>Python</summary>

`1 passed, 1 deselected`, then the two lines.

</details>

<details>
<summary>TypeScript</summary>

`Tests  1 passed | 1 skipped (2)`, then `PASS  TypeScript (tsc): typescript/missions/00-first-words/start.ts typechecks`, then the two lines.

</details>

<details>
<summary>Java</summary>

`1 passed`, then the two lines.

</details>

**Talk to it.** Needs your key or a workshop token in `.env` ([README: Your API key](../../README.md#your-api-key)).

```sh
make run 00               # from the project folder, in the language you picked with make use
# in Docker: docker compose run --rm workshop make run 00   (workshop-java in the Java service)
```

After `[ready] the agent has your settings.` the first transcript line is `assistant:` followed by your greeting, before you type anything. Then type:

> "What can you help me with?"

The agent answers the way your prompt told it to: one short sentence and a question back, if you used the barista example. Press Ctrl-D (or Ctrl-C) to hang up. In Docker or Codespaces you hear nothing during the run; the transcript shows the agent's lines. Once you hang up, play `out/last-call.wav` on your machine to hear the voice you picked ([README: Hear your agent](../../README.md#hear-your-agent)). Listening is optional: the checks above read your Settings and the transcript, so they are the proof whether or not you can hear the run.

## Stuck?

| You see | What's happening | Fix |
|---|---|---|
| `FAIL  TODO 1: the prompt is your own, not the starter one` | `PROMPT` is still `You are a helpful assistant.` | Write your own (TODO 1), save, run `make check 00` again. |
| `FAIL  TODO 2: you picked a voice other than flux-hannah-en` | `VOICE` is still the starter's, or not a string (your language's block below says what else prints). | Pick one from the list in TODO 2. |
| `FAIL  TODO 3: agent.greeting is set` | `GREETING` is still `""`. | Give it a line. |
| `FAIL  TODO 1: the prompt is at least a sentence (20+ characters)` | `PROMPT` is your own but shorter than 20 characters. | Give the agent a whole sentence: who it is and how it talks (TODO 1). |
| `FAIL  TODO 3: the agent says your greeting back to you` with `TODO 3: agent.greeting is set` passing | `GREETING` is set but the replay heard no assistant line: the greeting is blank after trimming, or Settings went out without it. | Put a real sentence in `GREETING` and keep it on the `greeting` line of the function that builds Settings. |
| `agent.speak.provider: aura-2-thalia-en is an Aura voice, so leave version out (or set "v1"); version "v2" is for flux-* voices (the speak provider line in ...)`, ending with the name of your function that builds Settings | You picked an Aura-2 voice and `"version": "v2"` is still on the `speak` line. | Remove the `version` field on the `speak` line (your language's block under Do this has the line). `Your file:` points at that function. |
| `agent.speak.provider: flux-cliff-en is a Flux voice, so set version "v2"; "v1" (the default) is for aura-* voices (the speak provider line in ...)`, with your voice's name, ending the same way | You picked a Flux voice and the `version` field is gone from the `speak` line (or reads `"v1"`). | Put `"version": "v2"` back on the `speak` line (your language's block under Do this has the line). |
| `DEEPGRAM_API_KEY is empty in .env (this folder)` on `make run 00` | No key or token yet. | [README: Your API key](../../README.md#your-api-key). `make check 00` needs neither. |
| The transcript shows the agent's lines and you hear nothing | Docker and Codespaces have no audio device. | Hang up, then play `out/last-call.wav` on your machine ([README: Hear your agent](../../README.md#hear-your-agent)). |

<details>
<summary>TypeScript</summary>

| You see | What's happening | Fix |
|---|---|---|
| `Your file has a TypeScript type error ... a cast is not the fix, unless the mission's brief shows one.` then `missions/00-first-words/start.ts(24,10): error TS2352: Conversion of type '{ audio: ...' to type 'Settings' may be a mistake ...` (under the `FAIL  TypeScript (tsc)` line) | A constant has the wrong type (`VOICE = 42`, say). The constants here carry no type, so tsc points at the `return {` line that `buildSettings()` casts `as Settings`: seven lines below the value in the unedited file (a longer prompt above moves it). | Give the value the type the TODO comment names (a string for the voice). |
| `... convert the expression to 'unknown' first`, then three lines naming `agent.speak` | The cast tsc proposes is the one the line above warns against; the three lines say which field is wrong. | Ignore the `unknown` suggestion; fix the value. |

</details>

Truly stuck? The reference answer is beside your start file (your language's block under Do this names it). Reading it is part of the workshop, so open it when you need it; `make check 00 MISSION_TARGET=solution` runs it.

Anything else is in the README's [Troubleshooting](../../README.md#troubleshooting), which points at your language's page.

## Going further

- **An Aura-2 voice** (offline, `make check 00`). Set `VOICE = "aura-2-thalia-en"` and leave the `speak` line as it is: the Aura line from the Stuck? table prints, with `Your file:` pointing at the function that builds Settings. Remove the `"version": "v2"` field and the check passes again. Aura-2 voices take no `version`; Flux voices take `"v2"`.

The rest runs live (`make run 00`), so it needs your key or a workshop token in `.env`.

- Add `"speed": 1.1` inside `agent.speak.provider` and listen to the difference (Flux voices take 0.5 to 1.5, in steps of 0.05).
- Add to the prompt mid-call without reconnecting: send one [`UpdatePrompt`](https://developers.deepgram.com/docs/voice-agent-update-prompt) (the call is in the block below), for example after the third user turn. `UpdatePrompt` adds to the prompt the agent already has: send only the new lines, and the Settings prompt and any earlier updates stay in force.

<details>
<summary>Python</summary>

`await agent.update_prompt(...)`

</details>

<details>
<summary>TypeScript</summary>

`agent.updatePrompt(...)`

</details>

<details>
<summary>Java</summary>

`agent.updatePrompt(...)`

</details>
