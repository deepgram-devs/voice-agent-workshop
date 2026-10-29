# 04 Polyglot

**Goal:** one conversation in two languages. The agent hears whichever language you speak, and its voice follows you.

**You'll learn**

- One listener for every language, `flux-general-multi`, and what `languages` on a user turn tells you
- Changing the voice mid-call with `UpdateSpeak`, and what the server answers
- Ending cleanly when a switch fails

**Layer:** hearing. **Features:** `multi_stt`, plus one Aura-2 voice per language.

## Before you start

- **Runs on your own key:** yes. Multilingual hearing (`multi_stt`) and the Aura-2 voices this mission uses work on any Deepgram project.
- Your start file open in your editor: `python/missions/04-polyglot/start.py`, `typescript/missions/04-polyglot/start.ts` or `java/missions/m04_polyglot/Start.java`. The rest of this page calls it your start file.
- Headphones and your microphone, if you want to hear the switch. Typed lines carry no `languages`, so the voice switch needs a spoken turn (Going further says how); the checks need none.

## What you're building

One listener, [`flux-general-multi`](https://developers.deepgram.com/docs/voice-agent-stt-models), hears every language it supports, and keeps up when you switch partway through a conversation. `language_hints` tells it which languages to expect. With it on, each user `ConversationText` carries two extra fields ([Multilingual voice agents](https://developers.deepgram.com/docs/multilingual-voice-agent) covers the listener and the hints; the voice switch below is this mission's own):

```text
ConversationText (role: user)
  content            what you said
  languages          the languages it heard in that turn, most words first: ["es", "en"]
  languages_hinted   the hints you gave it
```

The voice is a separate setting, and you can change it mid-call without reconnecting: send [`UpdateSpeak`](https://developers.deepgram.com/docs/voice-agent-update-speak) with a new `speak` block. The server answers `SpeakUpdated` (or `Error`), and the new voice takes effect from the agent's next reply.

**About the voices.** This mission uses Aura-2 voices, one per language. They live in the `VOICES` map at the top of your start file, with voices for `en`, `es`, `de`, `fr`, `it`, `nl` and `ja`; [Voices and languages](https://developers.deepgram.com/docs/tts-models) lists every Aura-2 id by language. To try other voices, including `multi_tts` voices (the multilingual text-to-speech feature), swap the ids in that map and nothing else changes. With a workshop token, the proxy always accepts these public Aura-2 voices, so the map works as it is. A `multi_tts` voice goes through only while the workshop has `multi_tts` live; otherwise the proxy sends a `FEATURE_OFF` warning and uses the default voice.

## Do this

Each TODO sits at a `TODO n:` comment in your start file, with the exact call to make.

1. **Hear every language** (`LISTEN_MODEL`, `LANGUAGE_HINTS`). Switch the listen model to `flux-general-multi` and hint at least two languages, including one beyond English and Spanish, for example `["en", "es", "fr"]`.
2. **Follow the language.** A user turn's main language is `languages[0]`, already read for you as `heard`. When it differs from the voice you're using and `VOICES` has a voice for it, send one `UpdateSpeak` with that voice and print `[voice] switching to <voice id> from the next reply`. Keep the old language in `previous` before you switch, so TODO 3 knows a switch is waiting. English, then Spanish, then Spanish again is exactly one `UpdateSpeak`.
3. **Handle a failed switch cleanly.** A voice your project can't use comes back as an `Error` (code `INVALID_SETTINGS`), and the server closes the call right after it. If an `Error` arrives while a switch is waiting, print one clear line saying which voice failed (the voice you switched to: the language field of your voice state still holds it) and why. "Why" is the error's `description` (the server's sentence), or its `code` when there is no description; your language's block has the field reads. Then hang up. The program ends on that line and sends nothing more.

<details>
<summary>Python</summary>

- Your start file: [`python/missions/04-polyglot/start.py`](../../python/missions/04-polyglot/start.py); the reference answer is `solution.py` beside it.

The failed voice is `VOICES[Voice.language]`; why is `event.get("description") or event.get("code")`; then `await agent.close()`.

</details>

<details>
<summary>TypeScript</summary>

- Your start file: [`typescript/missions/04-polyglot/start.ts`](../../typescript/missions/04-polyglot/start.ts); the reference answer is `solution.ts` beside it.

The failed voice is `VOICES[voice.language]`; why is `event.description ?? event.code`; then `agent.close()`.

</details>

<details>
<summary>Java</summary>

- Your start file: [`java/missions/m04_polyglot/Start.java`](../../java/missions/m04_polyglot/Start.java); the reference answer is `Solution.java` beside it.

`heard` is `null` on a typed turn (no `languages`), so test `heard != null` before you compare it; the reference answer's line is `if (heard != null && !heard.equals(voice.language) && VOICES.containsKey(heard))`. The failed voice is `VOICES.get(voice.language)`. For why: `String why = event.str("description"); if (why == null) why = event.str("code");` (`str` returns `null` for a missing field, never an empty string). Then `agent.close()`.

</details>

## Verify

**`make check 04` is the pass.** The offline check replays spoken turns, with their `languages`, so it covers the whole switch and the failed one, with no key:

```sh
make check 04             # from the project folder. Offline: two recorded conversations. No key
make live 04              # live: the multilingual listener is accepted and answers a Spanish line
make live 04 LIVE_AUDIO=1 # live, with recorded callers: the whole voice switch, both ways
# in Docker: docker compose run --rm workshop make check 04   (workshop-java in the Java service)
# in Docker: docker compose run --rm workshop make live 04   (workshop-java in the Java service)
```

The offline check replays two conversations. In `switch`, the caller speaks English, then Spanish, then Spanish again. It passes when Settings uses `flux-general-multi` with hints of your own (beyond `en` and `es`). Your program then sends exactly one `UpdateSpeak`, for the Spanish voice, after the Spanish turn. In `voice-error`, the switch to Spanish gets an `Error`, and the server closes the call 1.5 s later. It passes when your program sends nothing after the `Error` and hangs up first.

The live check sends a typed Spanish line and covers Settings being accepted and the agent answering. With `LIVE_AUDIO=1` it plays recorded callers instead and checks the switch both ways (Going further).

`UpdateSpeak` to a voice your project can use comes back `SpeakUpdated`. A voice it can't use comes back as `Error` with code `INVALID_SETTINGS`, and the server closes the connection right away. The `voice-error` replay leaves a short gap before it closes, so the check can see your program hang up on its own.

**Talk to it.** Needs your key or a workshop token in `.env` ([README: Your API key](../../README.md#your-api-key)).

```sh
make run 04               # from the project folder, in the language you picked with make use
# in Docker: docker compose run --rm workshop make run 04   (workshop-java in the Java service)
```

Type:

> "Hello, can you help me plan a trip?"

It answers in English. Then:

> "¿Puedes recomendarme un restaurante?"

It answers in Spanish, in the same voice. To hear the voice switch, say the two lines instead (Going further). Watch for `[voice] switching to ...` in the transcript, then play `out/last-call.wav` on your machine after you hang up. Ctrl-D (or Ctrl-C) hangs up.

## Stuck?

| You see | What's happening | Fix |
|---|---|---|
| No `[voice] switching to ...` line when you type Spanish | A typed turn (Before you start): TODO 2 has nothing to compare. | Expected. Speak it, or run `make live 04 LIVE_AUDIO=1` (Going further). |
| `FAIL  TODO 1: listen with flux-general-multi and give language_hints at least two languages of your own choosing, not just "en" and "es" (for example "en", "es" and "fr")` | `LISTEN_MODEL` or `LANGUAGE_HINTS` is still the starter's. | `flux-general-multi` and a third language (TODO 1). |
| `FAIL  TODO 2: when a user turn comes back in a new language (languages[0] is "es"), send UpdateSpeak with that language's voice` | No `UpdateSpeak` after the Spanish turn. | TODO 2. |
| `FAIL  TODO 2: switch once. English, then Spanish, then Spanish again needs exactly one UpdateSpeak` | You compare against the hint list or the last turn instead of the voice in use. Switching on every turn prints three more `TODO 2` lines under it (`... not before`, `... a different voice from the one in Settings`, `... the Spanish voice (VOICES["es"])`): same cause. | Compare `heard` with the voice you're using; one switch per change fixes all four (TODO 2). |
| `FAIL  TODO 3: handle a failed voice switch. Finish TODO 2 first: this check starts from your UpdateSpeak` | `voice-error` has nothing to test until a switch goes out. | Finish TODO 2, then TODO 3. |
| `FAIL  TODO 3: when a voice switch gets an Error, print one clear line (which voice, and why) and hang up with agent.close(). The server ends the call after this error anyway` | You printed the line but never closed. | Print one line, then close (TODO 3). |
| `FAIL  TODO 3: after the Error, send nothing more: no second UpdateSpeak and no other message. The call is over` (with the row above it) | Your program kept sending after the `Error`. | Close, and send nothing more (TODO 3). |
| `FAIL  TODO 2: after the Spanish turn, send UpdateSpeak with the Spanish voice (VOICES["es"])` or `FAIL  TODO 2: when the caller goes back to English, switch back to the English voice` in `make live 04 LIVE_AUDIO=1` | The recorded callers were heard as `es` then `en` and your program didn't switch, or switched only one way. | Compare `heard` with the voice in use on every user turn (TODO 2); `make check 04` shows the Spanish half with a recorded call. |
| `Error` with code `INVALID_SETTINGS` on your own key, then the call closes | `UpdateSpeak` named a voice your project can't use. | Keep the public Aura-2 voices in `VOICES`, or pick one your project has. |
| A `FEATURE_OFF` warning and the default voice, with a workshop token | You put a `multi_tts` voice in `VOICES` while the workshop has `multi_tts` off. | The Aura-2 map works as it is; swap the ids back. |

Truly stuck? The reference answer is beside your start file (your language's block under Do this names it). Reading it is part of the workshop, so open it when you need it; `make check 04 MISSION_TARGET=solution` runs it.

Anything else is in the README's [Troubleshooting](../../README.md#troubleshooting), which points at your language's page.

## Check yourself

You typed a Spanish line, the agent answered in Spanish, and no `[voice]` line printed. Bug?

<details>
<summary>Answer</summary>

No. A typed turn gives TODO 2 nothing to compare (Before you start says why); the words switched because the model follows you, the voice did not. A spoken Spanish turn (or `make live 04 LIVE_AUDIO=1`) is heard as `es` and triggers the switch.

</details>

## Going further

Everything here runs live (`make run 04`), so it needs your key or a workshop token in `.env`; the items marked microphone need a spoken turn too.

- **Hear the switch (microphone).** Say the two Verify lines instead of typing them (your language's block below says how; Docker and Codespaces have no microphone, so there you type your turns), watch for `[voice] switching to ...`, then play `out/last-call.wav`.
- **Recorded callers.** `make live 04 LIVE_AUDIO=1` plays a recorded Spanish caller, then an English one once the agent's Spanish answer has finished (`fixtures/audio/`). Spoken turns carry `languages`, so this path checks the whole switch: the Spanish turn is heard as `es`, your program sends `UpdateSpeak` with the Spanish voice, the agent answers `SpeakUpdated`, and the English turn switches the voice back.
- Hint a third language, say a line in a language you didn't hint (microphone), and see whether it follows.
- Also steer the words on a switch: send one `UpdatePrompt` (the call is in the block below) with "From now on, answer in Spanish." `UpdatePrompt` adds to the prompt the agent already has, so send only the new line. Each switch adds one more, so name the language in every one (microphone, as for the switch itself).
- Mixed turns: `languages` can list two languages. Try switching only when the second language has taken over for two turns in a row (microphone).

<details>
<summary>Python</summary>

Python only: `make run 04 MIC=1` (headphones on, or the agent hears itself through your speakers). `await agent.update_prompt(...)` for the prompt.

</details>

<details>
<summary>TypeScript</summary>

This one is heard in the Python track; the check is the proof. Type your turns here. `agent.updatePrompt(...)` for the prompt.

</details>

<details>
<summary>Java</summary>

This one is heard in the Python track; the check is the proof. Type your turns here. `agent.updatePrompt(...)` for the prompt.

</details>
