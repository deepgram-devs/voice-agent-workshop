# Voice agent workshop

Most voice agents, programs you talk to that answer out loud, go quiet the moment they have to look something up. By mission 03, yours keeps talking. This workshop is for people who have written some Python, TypeScript or Java and zero voice AI. If you have never opened a WebSocket, never sent audio to an API and are not sure what an "agent" is, you are exactly who this was written for. A WebSocket is a network connection that stays open so both sides can send whenever they like. Every term is explained the first time it comes up, every command is one you paste, and you never start from a blank file.

You build a voice agent one layer at a time (hearing, timing, thinking, voice) on the Deepgram Voice Agent API. It uses Deepgram's official SDKs (software development kits): the `deepgram-sdk`, `@deepgram/sdk` and `deepgram-java-sdk` packages, which handle the connection so your code handles the conversation. A **mission** is a small program you finish yourself, a few numbered TODOs in one file, plus a check that tells you whether it works. There are seven, numbered 00 to 06.

Setup is one page per language ([Pick a language](#pick-a-language)), the same in the room and at home; [At the workshop or remote](#at-the-workshop-or-remote) covers what differs, and [Words used here](#words-used-here) collects every term.

## Pick a language

Your setup is one page, and that page is the whole walk. It has the tools with a check command for each, the clone, the first check and what it prints, the Codespaces and Docker ways in with nothing to install, and that language's own Troubleshooting rows. Open yours, and come back here for the missions.

### Python

[docs/python.md](docs/python.md): uv installs Python for you; your start files are `start.py`.

### TypeScript

[docs/typescript.md](docs/typescript.md): Node.js 22 and pnpm; your start files are `start.ts`, and every check also typechecks your file.

### Java

[docs/java.md](docs/java.md): a JDK 17 or newer, with Maven in the project; your start files are `Start.java`. In Docker, Java has its own service, `workshop-java`.

You pick once, with `make use py`, `make use ts` or `make use java` (your page says when). It prints a `Saved:` line and saves the choice in `.workshop-lang` (Git ignores it); `make check`, `make run` and `make live` use it from then on and name the file they work on. Switch any time with `make use`. Node.js runs the checks whichever language you pick, so keep it installed.

## On Windows

Three ways in, and the project works as is in each:

- **GitHub Codespaces**, the quickest: the badge on your language's page, in any browser. Nothing to install.
- **WSL** (Windows Subsystem for Linux: a real Ubuntu inside Windows): in an administrator PowerShell, run `wsl --install`, restart, and open Ubuntu. Inside Ubuntu, run `sudo apt update` once, then install make, curl, git and Node.js 22 with the Ubuntu commands under Before you start on your language's page, plus your language's tool. Then clone the repo into your Linux home folder (`cd ~` first; it runs much faster there than under `/mnt/c`) and follow that page's Do this. `code .` opens the folder in VS Code, and `explorer.exe out` opens the folder with `last-call.wav` in Windows, to play it.
- **Docker Desktop:** the Run it in Docker commands on your language's page work in PowerShell, from a clone anywhere. In VS Code, choose **Dev Containers: Clone Repository in Container Volume**.

In WSL and in containers, type your turns: every mission works without a microphone.

## Your API key

Two ways to run live, and the offline checks (`make check`) need neither:

- **At the workshop, in the room:** a workshop token, no key of your own. Paste the two `WORKSHOP_` lines from the workshop site's `/code` page into `.env`, and every run shows on your map. [At the workshop or remote](#at-the-workshop-or-remote) has the steps.
- **At home, or after the event:** your own key; runs on it stay off your map. Sign up at [console.deepgram.com/signup](https://console.deepgram.com/signup) and create a key under **API Keys**; new accounts come with free credit, and you'll paste the key once. Then open `.env` in the project folder: `code .env` opens it in VS Code (or open it from your editor's File menu). `make setup` (your language's page runs it) created it there from `.env.example`; it is in the project folder, not in a language's folder. Find the line `DEEPGRAM_API_KEY=` and put your key after the `=`, so the line reads `DEEPGRAM_API_KEY=your_key_here` with no quotes or spaces, then save the file.

Keep the key in `.env`. Git ignores that file, and nothing in this project prints the key. In Codespaces, you can add `DEEPGRAM_API_KEY` as a Codespaces secret (a value GitHub stores for you and sets in the codespace) instead. A secret is your own key; once you paste a workshop token into `.env`, the helpers (the shared code every start file imports; [Words used here](#words-used-here)) use the token instead.

## How a mission works

Each mission has three parts:

| Where | What |
|---|---|
| `missions/NN-name/README.md` | The brief: what you're building and the TODOs |
| Your start file (the `NN-name` start file in your language's folder; [Words used here](#words-used-here) has the three paths) | Fill in the TODOs here |
| The reference answer beside it | For when you're stuck; `MISSION_TARGET=solution` runs it |

Each TODO sits at a `TODO n:` comment in the start file, with the exact call to make. The brief says what each one is for. Where a brief has a block per language, open your language's block each time one appears; the other two are for the other tracks. Three commands, run from the project folder (the one with the `Makefile`; from inside `python/`, `typescript/` or `java/`, make finds no rule). In Docker, put `docker compose run --rm workshop` in front of each (`workshop-java` for Java). The first is **offline**: the check harness replays a recorded conversation against your code on your machine, and nothing reaches Deepgram. The other two are **live**: a real conversation with the real agent, on your key or a workshop token.

```sh
make check 00            # offline check: replays a recorded conversation against your code. No key
make run 00              # talk to your agent: type a line, press Enter. Ctrl-D (or Ctrl-C) hangs up. Needs your key or a workshop token in .env
make live 00             # live check: a real conversation with the real API. Needs your key or a workshop token in .env
```

They use the language you picked with `make use`. `make help` lists them, with `Missions with checks:` and the seven mission folders.

You can pipe lines in too: `printf 'hello\nwhat can you do?\n' | make run 00`. It waits for the greeting to finish. Then it sends each line once the agent has finished its reply to the one before, and hangs up after the reply to the last line.

`make run` saves what the agent said to `out/last-call.wav`, so you can hear the voice you picked (see [Hear your agent](#hear-your-agent)). The Python track can also use your microphone and speakers: `make run 00 SDK=py MIC=1` (the [Python page](docs/python.md#hear-your-agent) has it).

Wear headphones: without them your agent hears itself through your speakers, and your neighbor's agent too. No headphones? Type your turns and keep the volume low; every mission works typed. The microphone runs in Python, on your own machine, where the audio device is (in Codespaces, a container or over SSH, type your turns). Building in TypeScript or Java, run the Python reference answer for the microphone parts with `make run NN SDK=py MIC=1 MISSION_TARGET=solution`.

Never talked to a voice agent? The [Deepgram Voice Agent Playground](https://playground.deepgram.com/voice-agent) runs one in the browser: say hello, interrupt it, notice that it stops.

**Check yourself.** You change `PROMPT`, save, and run `make check 00` again. Does the check need your key?

<details>
<summary>Answer</summary>

No. The offline check replays a recorded conversation against your code on your machine; nothing reaches Deepgram. `make run 00` and `make live 00` are the two that do, and they need your key or a workshop token in `.env`.

</details>

### Hear your agent

Every `make run` saves the agent's side of the call to `out/last-call.wav` when you hang up. So you can hear the voice, speed and greeting you picked. On a laptop, open it in any audio player (on macOS, `open out/last-call.wav`; on Linux, `xdg-open out/last-call.wav`; in WSL, `explorer.exe out`). A call that brought back no audio prints a `[no audio]` line instead and leaves the file as it was.

In Codespaces, a remote machine or a container, there is no audio device: type your turns as usual, then download the file. In Codespaces or VS Code, right-click `out/last-call.wav` in the Explorer and choose **Download**. Over SSH, copy it with `scp`. Each run writes a new `last-call.wav`, so download the one you want before the next run.

## Missions

| # | Mission | Layer | Runs on your own key? | With a workshop token |
|---|---|---|---|---|
| 00 | [First words](missions/00-first-words/README.md) | voice | Yes | Yes |
| 01 | [Let me finish](missions/01-let-me-finish/README.md) | timing | With a Deepgram project that has the `timing` feature | Yes |
| 02 | [Read the room](missions/02-read-the-room/README.md) | timing | With a Deepgram project that has the `timing` feature | Yes |
| 03 | [No dead air](missions/03-no-dead-air/README.md) | thinking | Yes: function calls and injected lines work on any key. The optional `thinking` stretch runs on a Deepgram project that has the `thinking` feature, with its model id in `.env` | Yes. The `thinking` stretch follows the workshop's setting |
| 04 | [Polyglot](missions/04-polyglot/README.md) | hearing | Yes: multilingual hearing and its Aura-2 voices work on any key | Yes. The proxy always accepts the public Aura-2 voices in your `VOICES` map. A voice outside its list comes back as a warning and the default voice |
| 05 | [Mystery guest](missions/05-mystery-guest/README.md) (finale) | all | Yes | Yes |
| 06 | [Encore](missions/06-encore/README.md) (bonus) | voice | Yes | Yes |

Every mission has its exercise in every language, an offline check and a live check. The offline checks need no key and no network, so you can finish 01 and 02 offline with any project.

A run on your own key stays on your laptop: the workshop site never sees it, so tick **Your code passed make check NN** yourself. A run with the workshop token shows on your map on its own.

If your Settings (the one message that sets the agent up; mission 00 opens with it) use a feature your Deepgram project doesn't have, the agent answers with an `UNPARSABLE_CLIENT_MESSAGE` error. The helpers print what it means and what to do next.

## At the workshop or remote

On event day, in the room: the token. After: your own key. Your own key runs everything on your laptop against Deepgram's public API, and missions 00, 03, 04, 05 and 06 work as they are; 01 and 02 need a project that has the `timing` feature. The token runs your code through the workshop's agent and covers every mission, including 01 and 02, which use the `timing` feature.

The workshop site is [workshops.deepgram.com/builders-lab](https://workshops.deepgram.com/builders-lab). (`wss://` is a WebSocket address, the encrypted kind, as `https://` is to `http://`.)

**Get the token.** On the workshop site, in the browser that has your handle, open **Build this in code** from your map (`https://workshops.deepgram.com/builders-lab/code`). Choose **Get a code-project token**. Played on your phone? On your laptop, open `https://workshops.deepgram.com/builders-lab/resume`, enter your handle and your four-digit code, then open `/code`: the button shows only where your handle is, and only while the workshop proxy is open on event day. The page shows two lines once; paste them into `.env`, replacing the empty `WORKSHOP_URL=` and `WORKSHOP_TOKEN=` lines:

```sh
WORKSHOP_URL=wss://workshops.deepgram.com/builders-lab/sdk
WORKSHOP_TOKEN=wst_...
```

**Run, hang up, look.**

1. Run `make run NN` or `make live NN`. It goes through the workshop proxy, which files the conversation under its mission. Only those two count on your map; `make check` stays offline.
2. Hang up (Ctrl-D or Ctrl-C) after at least one reply from the agent, or there is nothing to check. The workshop then runs that mission's checkpoints against the conversation.
3. Open the mission on the workshop site (a passing `make check` prints its address, `https://workshops.deepgram.com/builders-lab/m/<mission>#run-it`; in a browser without your handle it opens `/resume` first). Its last step, **Run it in your code**, shows `Last run from your code: <time>` with a line per checkpoint, and the diamond on your map fills in. **Your program talked to the agent** ticks by itself after a token run; **Your code passed make check NN** you tick with **I did this**. Checkpoints tagged **Web only** pass only in the browser.

A token lasts 8 hours and runs one program at a time; the proxy applies the workshop's settings rules; after the event a token is refused. The codes for all of that, and what to do, are under [Workshop token](docs/troubleshooting.md#workshop-token) in the full troubleshooting table.

With `WORKSHOP_URL` and `WORKSHOP_TOKEN` both set (and `DEEPGRAM_AGENT_URL` empty), the helpers use the token. That holds even when a `DEEPGRAM_API_KEY` is set too (in your shell, or as a Codespaces secret): `make run` then prints one `[credentials] Using your workshop token (the proxy); ...` line, which is information, not an error.

## Troubleshooting

Every one of these has happened to someone smart. Find the line you see in the first column, read what it means, apply the fix, carry on. These are the lines every language hits on a first run. Your language's page has its own rows ([Python](docs/python.md#troubleshooting), [TypeScript](docs/typescript.md#troubleshooting), [Java](docs/java.md#troubleshooting)), and the full table, workshop-token codes and the proxy's lines included, is [docs/troubleshooting.md](docs/troubleshooting.md). Each mission brief has a shorter Stuck? table for that mission's own failures.

| You see | What's happening | Fix |
|---|---|---|
| `Pick your language first` (with `make: *** [Makefile:...: need-sdk] Error 2` beside it) | No language is saved yet. | Run `make use py`, `make use ts` or `make use java` once (see [Pick a language](#pick-a-language)). |
| `The check harness isn't installed` (with `make: *** [Makefile:...: need-sdk] Error 2` beside it, as under the pick line) | `make setup` hasn't run in this folder yet, or its install is gone: after `docker compose down -v` the next `docker compose run` recreates the volumes empty, and this is the first line you see. | Run the `make setup` the line names (`docker compose run --rm workshop make setup` in Docker, `workshop-java` in the Java service). It is the plain `make setup`: the harness, then every track whose tool it finds (next row). The checks need Node.js 20.19+ or 22.12+, whichever language you pick. |
| `cd python && uv sync` or `cd typescript && pnpm install --frozen-lockfile` (or `cd java && sh mission.sh setup`) during a `make setup` you ran for another language | Plain `make setup` installs the harness, then every track whose tool it finds: in the Docker image, Python and TypeScript; Java too in `workshop-java` once it is your language. | Nothing: let it finish. pnpm may print a boxed `Update available!` notice ending `To update, run: curl -fsSL https://get.pnpm.io/install.sh \| sh -`: ignore it; the pnpm you have is fine. `make setup SDK=py` (or `SDK=ts`, `SDK=java`) installs the harness and one track. |
| `The checks need Node.js 20.19+ or 22.12+` | Your Node.js is older than that, or a `v21`. | Install Node.js 22 (from [nodejs.org](https://nodejs.org), NodeSource or nvm), open a new terminal, and run `make setup` again. |
| `make: command not found` / `Command 'make' not found` | make isn't installed. | `xcode-select --install` on macOS, `sudo apt install make` on Ubuntu or Debian, `sudo dnf install make` on Fedora. Then run `make setup`. On Windows, see [On Windows](#on-windows). |
| `'make' is not recognized` / `The term 'make' is not recognized` / `On Windows, this project runs in GitHub Codespaces or in WSL` | You are in Windows itself (PowerShell, cmd or Git Bash), where this project runs in GitHub Codespaces or in WSL. | See [On Windows](#on-windows). |
| `make: *** No rule to make target 'xxx'` | `xxx` isn't a command here. With `'run'`, `'check'` or `'live'` in the quotes, you are in the wrong folder: `python/`, `typescript/` or `java/` has no `Makefile`. | `make help` lists them: `setup`, `use`, `check`, `run` and `live`. Run them from the project folder (`cd ..` from a language's folder). |
| `FAIL  TODO n: ...` lines, `Your file: <your start file>:<line> (TODO n)`, then `make: *** [Makefile:...: check] Error 1` | The offline check found open TODOs. On the first `make check 00` that is the point. | Open the file and line it names. The mission's brief has a Stuck? table keyed on the `TODO n:` lines. |
| `Mission NN passes its offline check: <your start file>` then `Next: make run NN ...` | Every TODO passes. | Do what the `Next:` line says: `make run NN`, then `make live NN`, with your key or token in `.env`. |
| `DEEPGRAM_API_KEY is empty in .env (this folder)` (and `make` adds `make: *** [Makefile:...: run] Error 2`) | `.env` exists (`make setup` created it) and the key line is still empty. | Open `.env` in the project folder (not in `python/`, `typescript/` or `java/`). Put your key after `DEEPGRAM_API_KEY=`, or paste the two token lines from the workshop's `/code` page. Run the command again; `make check NN` needs neither. |
| `No Deepgram credentials. Copy .env.example to .env` | There is no `.env` in the project folder. | Run `make setup` (it creates one) or `cp .env.example .env`, then set `DEEPGRAM_API_KEY` in it. |
| `make live talks to the real agent, so it needs DEEPGRAM_API_KEY` | `make live` and `make run` need your key (or a workshop token) in `.env`. | Put one in `.env`. `make check NN` needs neither. |
| `WORKSHOP_TOKEN is set but WORKSHOP_URL is empty` | Only the token line made it into `.env`. The token needs `WORKSHOP_URL` beside it. | Copy both lines from the `/code` page into `.env`. |
| `[credentials] Using your workshop token (the proxy); your DEEPGRAM_API_KEY is set too and waits for after the event. To run on it now, leave WORKSHOP_TOKEN empty.` | Both a key and a token are set, and the token is used. Information, not an error. | Nothing: this is the event-day path. To run on your own key instead, leave `WORKSHOP_TOKEN` empty. |
| `Deepgram refused the connection (HTTP 401). Check DEEPGRAM_API_KEY.` (in `make live`, the harness prints it as `FAIL  Deepgram refused the connection: HTTP 401. Check DEEPGRAM_API_KEY.`) | The key is wrong or was deleted. | Make a new one in the console and paste it again, with no quotes or spaces. |
| `DEEPGRAM_API_KEY has a character a key can't have` / `WORKSHOP_TOKEN has a character a token can't have` | The value holds a space, a curly quote, a no-break space or another character from copy and paste (a chat, a doc, a notes app) inside it. A trailing space or no-break space is trimmed instead, in every language: a wrong key then shows as `Deepgram refused the connection (HTTP 401)`. | Copy the key again from the console (or the token from `https://workshops.deepgram.com/builders-lab/code`) and paste it into `.env` as plain text, with no quotes or spaces. |
| `Could not reach the agent: connection refused. Check DEEPGRAM_AGENT_URL.` on `make run` (with a workshop token: `... Check WORKSHOP_URL. Is the workshop site up?`), then `make: *** [Makefile:...: run] Error 2` (the no-helpers examples print the first line too, with no `make:` tail) | Nothing answered at the address: venue wifi or a proxy that blocks WebSockets (the encrypted kind, `wss://`, port 443), a VPN, or a `DEEPGRAM_AGENT_URL` that points somewhere real but wrong (an address that starts with `ws://` or `wss://` and names a host passes the address check and is dialed). | Leave `DEEPGRAM_AGENT_URL` empty for Deepgram production. If it already is, the network is the cause: try a phone hotspot. `make check NN` works offline, so the checks need none of it. |
| `Could not reach the agent: <detail>. Check DEEPGRAM_AGENT_URL.` with another detail (`no such host`, `it timed out`; your language's page lists its forms; with a token, `... Check WORKSHOP_URL.` with no question after it) | The address did not resolve, or nothing answered in time: the same network causes as the row above. | The same. |
| `relaying to production` (or `custom endpoint`, or `workshop proxy`), then two lines down `FAIL  Could not reach production: ...` (the mission's `NN-name live` header between them), in `make live`'s failure output | `make live` goes through the check harness, which prints its own line and replaces the address with that label. Same causes as the two rows above. | The same. The offline check, `make check NN`, needs no network. |
| `DEEPGRAM_AGENT_URL needs your own DEEPGRAM_API_KEY. With a workshop token, leave DEEPGRAM_AGENT_URL empty` (in `make live`, the same line with `harness: ` in front; in TypeScript it sits inside vitest's `CheckFailed:` block) | `.env` has `WORKSHOP_TOKEN` and `DEEPGRAM_AGENT_URL` set and no `DEEPGRAM_API_KEY`. A workshop token works only through the workshop proxy, which picks the endpoint. | Leave `DEEPGRAM_AGENT_URL` empty (the token then goes through the proxy), or set your own key and leave `WORKSHOP_TOKEN` empty. |
| `.env line N couldn't be read` (Python and Java; TypeScript prints a different line, its page says. On `make run` it prints first; under `make check` and `make live`, Python holds it in pytest's `Captured stderr call` on a failing check, Java prints it under the header) | A quote on that line never closes or has words after it, or the line isn't `KEY=value`. On the key's line, the `is empty` line follows it: fix line N, not the key. (A bare word with no `=` is skipped without a line: the key then reads as empty, and the `is empty` row above is what you see.) | Write it as `KEY=value` on one line; quotes around a value are optional, with nothing after the closing quote but a `# comment`. |
| `.env isn't UTF-8 text` (Python and Java) | Your editor saved `.env` in another encoding. (TypeScript reads such a file differently: its page says.) | Save `.env` as UTF-8 (plain text) in your editor, then run it again. |
| `failed to read .../.env: line N: key cannot contain a space` (Docker, before anything else prints) | Docker Compose reads `.env` too, before the container starts, and stops on a space where a key would be: two or more words after a closing quote (`DEEPGRAM_API_KEY="abc" extra words`: `extra words` reads as the next key). A bare word with no `=` passes Compose (the `.env line N` row above). | Fix line N of `.env` and run the command again. One word after a closing quote gets through instead, to your language's own row: `.env line N couldn't be read` in Python and Java, `has a character a key can't have` in TypeScript. If line N is a comment, a quote above never closed: the row below. |
| `failed to read .../.env: line N: unterminated quoted value "abc` (Docker, before anything else prints; `'abc` for a single quote), or `failed to read .../.env: line N: unexpected character "\"" in variable name "..."` when a line below holds a quote of yours | A quote opened on a line of `.env` never closed, so Compose read on as one value: to the end of the file (N is one past the last line; the fragment is the whole value after the quote), or to the next quote below, in a comment of yours (N is that line; the fragment is its text after that quote). | Find the line that opens a quote and never closes it (usually the key line; second form: above line N), remove or close the quote, and run the command again. The first form's fragment is the value, your key on the key line: paste that line nowhere. Outside Docker your language's own line prints. |
| `Resource is still in use` after `docker compose down -v` | A container from this project is still running (another terminal's `make run`, or another copy of this repo, which shares the same volumes). | Stop it, then run `docker compose down -v` again. The first `down -v` still exits 0 with that line, so read the output, not the prompt. |

## Staying connected

`run` ends when the connection drops. For a program you'll leave running, use the resilient runner your language's page shows under Keep going (`run_resilient` in Python, `runResilient` in TypeScript; Java has none: run the program again after a drop). It reconnects with a growing wait, sends your Settings again on every new connection, and prints each close code. It reconnects on a network drop (1006) or a server error (1011 to 1014). It stops when you hang up, on a clean close, and when the key or token is refused. It also stops when the workshop refuses or pauses the conversation (the `[workshop]` codes above). A reconnect starts a new conversation.

## Coming from SDK v3

These missions use the current SDKs, not v3. In Python the pin is `deepgram-sdk` 7.12.0: you make an `AsyncDeepgramClient`. You open the agent with `async with client.agent.v1.connect() as socket`, then read events with `async for`. In TypeScript it's `@deepgram/sdk` 5.14.0, with `new DeepgramClient(...)` and `client.agent.v1.connect()`. v3's agent websocket client and its `.on(...)` event names are gone, so v3 code won't run on these pins. Install into a fresh environment (`make setup` makes one in `python/.venv`; in Docker, `/opt/venv`), not one that already has v3. Java: the Java SDK has no v3, so there is nothing to migrate; the Java page's Keep going has the helpers.

The messages changed too. If you wrote an agent against the 2024 API, these are the current names:

| Earlier | Now |
|---|---|
| `SettingsConfiguration` | `Settings` |
| `agent.listen.model` | `agent.listen.provider.model` |
| `agent.think.model` | `agent.think.provider.model` |
| `agent.think.instructions` | `agent.think.prompt` |
| `agent.speak.model` | `agent.speak.provider.model` |
| a function's `url`, `method`, `headers` | the function's `endpoint` |
| `UpdateInstructions` | `UpdatePrompt` |
| `FunctionCallRequest` `function_name`, `function_call_id` | a `functions` list, each with `id`, `name`, `arguments` |
| `FunctionCallResponse` `function_call_id`, `output` | `id`, `name`, `content` |

`make check` names each earlier field it finds in your Settings or your code and the field to use now. In TypeScript it also typechecks your start file. It fails on a type error; the fix is to give the value the type the TODO comment names, never to cast it. Mission 01's `event.functions` is the one exception: the cast is pre-written in its start file, and its brief says so.

## How this relates to the speech-to-text you already run

The Voice Agent API runs a whole pipeline on one WebSocket. It listens (STT: the same Deepgram models, `agent.listen`), thinks (an LLM, `agent.think`) and speaks (text-to-speech, TTS: Deepgram's Aura and Flux voices, `agent.speak`). All three are set in one `Settings` message, the first thing your program sends. Your STT code keeps working as it is; the agent is a separate endpoint (the address a program connects to). Usage bills to the key in use: your own key's project, or the workshop's with a workshop token.

## Before you ship it

A few parts here are for the workshop, not for production. `common.py` sends raw JSON (the text format these messages are written in) through the SDK's private `_send` (in `Agent.send_raw`). It closes the socket through a private `_websocket` in one place; swap both for public calls once the SDK has them. `common.ts` pings through the SDK's private `_ws` in one place (`rawSocket`): swap it for a public ping once the SDK has one. `make_client` / `makeClient` (`Common.makeClient` in Java) build the SDK environment by hand for the workshop proxy and the check harness. In your own app, use the SDK's default environment.

The `timing` block (missions 01, 02) and the `thinking` block (mission 03) each need their own feature (`timing`, `thinking`) on your Deepgram project. The mission briefs and [Troubleshooting](docs/troubleshooting.md) show what Settings answers on a project without it.

## With a coding agent

[AGENTS.md](AGENTS.md) tells a coding agent (Claude Code, Cursor, Copilot and the like) how this repo fits together. It covers the helpers to use, the Settings order, the SDK pins and the check loop. Point it at a mission brief and `make check NN`. AGENTS.md puts it in tutor mode: it explains each step before doing it and coaches you through the TODOs instead of writing them, unless you tell it to. It never needs to see your key. For Deepgram itself, give it the docs index at [developers.deepgram.com/llms.txt](https://developers.deepgram.com/llms.txt) or the Deepgram docs MCP server at [developers.deepgram.com/_mcp/server](https://developers.deepgram.com/_mcp/server).

## What's inside

```text
missions/NN-name/          the brief and the language-neutral check (check.mjs)
fixtures/NN-name/          recorded conversations the offline checks replay
python/agent/common.py     every Python SDK call in one place
typescript/src/common.ts   every TypeScript SDK call in one place
python/agent/resilient.py  run_resilient: run with reconnects (src/resilient.ts in TypeScript)
python/examples/           first_settings.py: the smallest program on the SDK, no helpers
typescript/examples/       first-settings.ts: the same in TypeScript
java/src/main/java/agent/  every Java SDK call in one place
java/examples/             FirstSettings.java: the same in Java (sh mission.sh example, from java/)
tools/replay-server/       the check harness (Node)
AGENTS.md                  notes for coding agents
docs/python.md, docs/typescript.md, docs/java.md   one page per language: tools, first check, Docker
docs/troubleshooting.md    the full table: every line the helpers, the checks and make print, with the fix
PARTNERS.md                what carries over to LiveKit, Pipecat, Vapi, Twilio and Telnyx
.devcontainer/             the Codespaces / Dev Containers setup
compose.yaml, Dockerfile   the same tools in Docker, without VS Code (Run it in Docker)
```

The smallest program, with no helpers: `uv run python examples/first_settings.py` (from `python/`), `pnpm tsx examples/first-settings.ts` (from `typescript/`) or `sh mission.sh example` (from `java/`). It sends Settings, waits for `SettingsApplied`, lets you type turns and saves the agent's voice to `out/last-call.wav`. With no key it stops on `DEEPGRAM_API_KEY is empty in .env (this folder). Set it: this example runs on your own key only (make run takes a workshop token too). make check NN runs offline with no key.` (`NN`: the example has no check; the token lines change nothing here). On a network failure each prints the same `Could not reach the agent: ...` line as `make run` and stops.

The SDK versions are pinned exactly (`deepgram-sdk` 7.12.0, `@deepgram/sdk` 5.14.0 and `com.deepgram:deepgram-java-sdk` 0.11.1). CI runs the offline checks on every push, against those pins and against the latest releases, with Java on JDK 17 and 21. It also runs each page's Docker commands on Docker Engine (including coming back after `docker compose down -v`), each page's laptop commands, and the Java page's Codespaces path on the dev container image. The nightly live checks run in Python and TypeScript against the pins when the repository has a `DEEPGRAM_API_KEY` secret. Without one (a fork, a clone of your own), the live job skips.

Building on LiveKit, Pipecat, Vapi, Twilio or Telnyx? [PARTNERS.md](PARTNERS.md) shows what carries over from the missions.

Writing a mission, or adding your language or framework? Read [CONTRIBUTING.md](CONTRIBUTING.md). The project is MIT licensed ([LICENSE](LICENSE)), so take any of it into your own app.

## Keep going

You came in with a start file that said `You are a helpful assistant.` You're leaving with an agent that waits for you, reads the room, talks through a slow tool, follows you into another language, plays a mystery guest and does an impression. [Words used here](#words-used-here) has the vocabulary.

**Keep the code.** Your clone is yours. The reference answers are beside every start file, and [Before you ship it](#before-you-ship-it) says which parts are for the workshop only.

**Tell us how it went.** At the event, the session's feedback form is the one the organizers and the speaker read; your facilitator points to it, and the workshop site's `/finish` page (your card) lists the event's next steps. Working through this alone? Open an issue on the repo: one line about the step that lost you is enough. Either way, the [Deepgram Discord](https://discord.gg/deepgram) is the place to say what you built and ask what to build next.

**Read on.**

- [Voice Agent API docs](https://developers.deepgram.com/docs/voice-agent): everything the Settings message can do; the missions used part of it.
- [Function calling](https://developers.deepgram.com/docs/voice-agents-function-calling): the handshake you now know from the inside (mission 03).
- [Configure the Voice Agent](https://developers.deepgram.com/docs/configure-voice-agent): every field of the Settings message. For the timing block (missions 01 and 02) and the thinking block (mission 03), the mission briefs carry what you need.
- [Inputs](https://developers.deepgram.com/docs/voice-agent-inputs) and [Outputs](https://developers.deepgram.com/docs/voice-agent-outputs): the messages your program can send and the events the server sends back, one page each; the mission briefs cover the timing and thinking messages and events.
- [STT models](https://developers.deepgram.com/docs/voice-agent-stt-models): the listen models (`nova-3`, `flux-general-en`, `flux-general-multi`) and the `version` each one takes; `LISTEN_MODEL` and `LISTEN_VERSION` in `.env` pick one for every mission but 04.
- [Keep alive](https://developers.deepgram.com/docs/agent-keep-alive): the `KeepAlive` message the helpers send for you while the line is quiet.
- The docs index for coding agents, [developers.deepgram.com/llms.txt](https://developers.deepgram.com/llms.txt), and the Deepgram docs MCP server, [developers.deepgram.com/_mcp/server](https://developers.deepgram.com/_mcp/server).

Your agent listens now. Give it something worth answering.

## Words used here

Every one of these is also explained where it first comes up; this table is for coming back.

| Term | Meaning |
|---|---|
| **mission** | One exercise: a brief, a start file per language, and a check. Numbered 00 to 06; `NN` in a command stands for the number |
| **start file** | The file you edit for a mission: `python/missions/NN-name/start.py`, `typescript/missions/NN-name/start.ts` or `java/missions/mNN_name/Start.java`. The `Makefile` and the hints call it the same thing |
| **TODO** | One numbered task inside a start file, marked by a `TODO n:` comment, with the exact call to make. The brief lists them by the same numbers |
| **reference answer** | The finished version beside each start file: `solution.py`, `solution.ts` or `Solution.java`. `MISSION_TARGET=solution` checks it instead of your start file. That run prints `Checking the <language> reference answer:` and your test runner's pass summary, with no `Mission NN passes` or `Next:` line |
| **offline check** | `make check NN`: the check harness replays a recorded conversation against your start file. No key, no network |
| **live check** | `make live NN`: the same mission against the real agent, with your key or a workshop token |
| **check harness** | The Node.js program under `tools/replay-server/` that runs the offline checks, whichever language you pick. `make setup` installs it; `The check harness isn't installed` means it hasn't, or its install is gone (Docker's `down -v`) |
| **workshop site** | The web app for the workshop, at [workshops.deepgram.com/builders-lab](https://workshops.deepgram.com/builders-lab). It runs the same missions in a browser |
| **handle** | Your name on the workshop site (something like `brisk-otter-42`), given when you start there, plus a four-digit code for coming back. The site keeps your progress under it |
| **map** | Your page on the workshop site: every mission with what you've passed. **Build this in code** on it opens `/code` |
| **workshop token** | A code-project token from the workshop site's `/code` page (`WORKSHOP_URL` and `WORKSHOP_TOKEN` in `.env`). It runs your program through the workshop's agent on event day, with no key of your own |
| **the proxy** | The workshop's server that a token connects to (`wss://workshops.deepgram.com/builders-lab/sdk`). It forwards your program's conversation to the agent and records the result on your map |
| **the helpers** | The shared code every start file imports: `python/agent/common.py`, `typescript/src/common.ts`, `java/src/main/java/agent/`. They connect, send Settings at `Welcome`, print the transcript and explain errors. Your missions call them; you never edit them |
