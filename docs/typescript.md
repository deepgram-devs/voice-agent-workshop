# TypeScript

**Goal:** mission 00's check running and naming the first TODO for you, in about five minutes (the Docker way adds the image build, a few minutes the first time). On your own machine that means installing pnpm, plus Node.js and make for the checks; Codespaces and Docker bring all three.

**You'll learn**

- What gets installed, and what the check harness is (a Node.js program that runs the checks)
- Where your key lives (`.env` in the project folder) and which commands need it
- What a failing and a passing check look like, including the typecheck, so you recognize them later

Want Python or Java instead? See [Python](python.md) or [Java](java.md).

## Before you start

You'll work in two windows the whole time: a **terminal** and a **code editor** (VS Code or whatever you already use). Open both now. On macOS the terminal is Terminal; on Linux, any terminal. On Windows, read [On Windows](../README.md#on-windows) first: the project runs there in GitHub Codespaces (a machine GitHub runs for you, in your browser) or WSL (Windows Subsystem for Linux). In Codespaces, both windows sit in one browser tab.

Prefer not to install anything? Two ways round the three tools below: GitHub Codespaces (**Can't install anything?**, further down) and Docker on your own machine ([Run it in Docker](#run-it-in-docker)). Otherwise:

- **Node.js 22** (22.12 or newer; 20.19 or newer works too). It runs the checks. Check by pasting this into the terminal:

  ```sh
  node --version
  ```

  If that prints `v22.12.0` or higher (any newer major, `v24` or `v26` say, is fine), or a `v20` from `v20.19.0` up, you're set. If it errors or prints something older, install it, then reopen your terminal:
  - **macOS, or any system:** the installer from [nodejs.org](https://nodejs.org), or nvm, a Node.js version manager ([github.com/nvm-sh/nvm](https://github.com/nvm-sh/nvm)): `nvm install 22`.
  - **Ubuntu 24.04 or Debian 12:** the `nodejs` package there is version 18, too old. `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -` then `sudo apt-get install -y nodejs` gets 22.
  - **Fedora:** `sudo dnf install nodejs npm` (Fedora 42's is new enough).
- **make.** Check with `make --version`; the first line names it (`GNU Make 4.3`, say). If it errors: on macOS, `xcode-select --install` adds it; on Ubuntu or Debian, `sudo apt update && sudo apt install make curl git`; on Fedora, `sudo dnf install make curl git`.
- **pnpm** 9 or newer. Once Node.js is in, `npm install -g pnpm@10` ([pnpm's install page](https://pnpm.io/installation) has other ways, including `curl -fsSL https://get.pnpm.io/install.sh | sh -`), then check:

  ```sh
  pnpm --version
  ```

**Can't install anything?** Work laptop, Chromebook, IT policies: run the whole workshop in GitHub Codespaces, free.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/deepgram-devs/voice-agent-workshop)

That opens an editor and a terminal in the browser, with Node.js, pnpm and make installed and `make setup` already run. From there:

1. Skip `git clone` and `make setup`: you are inside the project and it is set up.
2. Run `make use ts`.
3. Go to [Check that it works](#check-that-it-works): the offline check needs no key.
4. Before `make run`, add your key (or the two token lines) to `.env` (see [Your API key](../README.md#your-api-key)).

A codespace has no microphone or speakers: type your turns and download the agent's voice to listen (see [Hear your agent](#hear-your-agent)). VS Code's Dev Containers uses the same setup (`.devcontainer/`).

## Do this

Docker instead? Skip to [Run it in Docker](#run-it-in-docker); it has its own clone line.

Paste these into your terminal, one at a time:

```sh
git clone https://github.com/deepgram-devs/voice-agent-workshop.git
cd voice-agent-workshop
make setup SDK=ts
```

`SDK=ts` installs the **check harness** and TypeScript, and creates `.env`. The check harness is the Node.js program under `tools/replay-server/` that replays recorded conversations against your code for `make check`. pnpm may print a boxed `Update available!` notice ending `To update, run: curl -fsSL https://get.pnpm.io/install.sh | sh -`; ignore it. The first time, it ends with:

```text
Created .env: at the workshop, paste the two WORKSHOP_ lines from the /code page into it; at home, put your DEEPGRAM_API_KEY in it
Pick your language first: make use py (Python), make use ts (TypeScript) or make use java (Java)
```

Run it again later (a Troubleshooting row says to, or you come back to Docker after `down -v`) and, with your language picked, it ends with `Your language: TypeScript (saved in .workshop-lang). To switch: make use py or make use java` instead.

No `git` on your machine? Download the ZIP instead: green **Code** button, **Download ZIP** on the [repo page](https://github.com/deepgram-devs/voice-agent-workshop). Unzip it, `cd` into the folder it makes (`voice-agent-workshop-main`), and run `make setup SDK=ts` there.

Then pick your language, once:

```sh
make use ts
```

It prints `Saved: TypeScript. make check, run and live use it now. Add SDK=py to run one command in Python.` From then on `make check`, `make run` and `make live` use TypeScript and name the file they work on; the choice is saved in `.workshop-lang` (Git ignores it). [Pick a language](../README.md#pick-a-language) in the README covers switching.

## Your API key

The offline check below needs no key. Before `make run` or `make live`, open `.env` in the project folder (`make setup` created it), find the line `DEEPGRAM_API_KEY=` and put your key after the `=`, with no quotes or spaces; or paste the workshop's two token lines. [Your API key](../README.md#your-api-key) in the README says where a key comes from and how a Codespaces secret works, the same for every language.

## Check that it works

```sh
make check 00            # offline: no key, no network, a few seconds
```

This one fails on purpose: you haven't done mission 00 yet. The command prints `Checking your TypeScript file: typescript/missions/00-first-words/start.ts`, then vitest, TypeScript's test runner, prints its `RUN` banner, a `stdout` line with `[replay] [ready] the agent has your settings.`, then `× replay: greeting` and a `Failed Tests 1` banner. Inside its `FAIL missions/00-first-words/00.test.ts > 00-first-words > replay: greeting` output is this block. It has a `PASS` line for each part the start file already has, a `FAIL` line for each open TODO, then the file and line to open:

```text
  PASS  Your program sends a Settings message after Welcome
  PASS  Settings is the first message you send
  PASS  Settings has audio.input (encoding and sample_rate)
  PASS  Settings has audio.output
  PASS  Settings has agent.listen.provider.model
  PASS  Settings has agent.think.provider
  FAIL  TODO 1: the prompt is your own, not the starter one
  PASS  TODO 1: the prompt is at least a sentence (20+ characters)
  FAIL  TODO 2: you picked a voice other than flux-hannah-en
  FAIL  TODO 3: agent.greeting is set
  FAIL  TODO 3: the agent says your greeting back to you
Your file: typescript/missions/00-first-words/start.ts:12 (TODO 1)
```

If you see the `Your file:` line, everything is installed. After the block: a code frame (the lines around the error) pointing at the same line, `Tests  1 failed | 1 skipped (2)`, then `PASS  TypeScript (tsc): typescript/missions/00-first-words/start.ts typechecks` (tsc is the TypeScript compiler; every check also typechecks your file). It reads the whole `typescript/` folder, so a syntax error in another mission's file fails the check with a line naming that file (its own row under Troubleshooting). The `make: *** [Makefile:...: check] Error 1` under it is the failing check, which is the point. Open the file it names and start [mission 00](../missions/00-first-words/README.md); when its checks pass, come back to the README's [missions table](../README.md#missions) for the rest ([How a mission works](../README.md#how-a-mission-works) there is the reference for the three commands).

Once every TODO passes: `Tests  1 passed | 1 skipped (2)`, the `PASS  TypeScript (tsc)` line, then two lines. First `Mission 00 passes its offline check: typescript/missions/00-first-words/start.ts`, then the next step: `Next: make run 00 to talk to your agent (type a line, press Enter; Ctrl-D or Ctrl-C hangs up). It needs DEEPGRAM_API_KEY or your workshop token in .env. Then make live 00 runs the live check.` Missions with two recorded calls (02 to 05) end `Tests  2 passed | 1 skipped (3)` instead.

In Docker, each `make` in the `Next:` line reads `docker compose run --rm workshop make`. With `WORKSHOP_URL` in `.env`, two more lines name the mission's page on the workshop site and the checkpoint to tick there, **I did this** on **Your code passed make check NN** ([At the workshop or remote](../README.md#at-the-workshop-or-remote)). Anything else, a setup error say, is under [Troubleshooting](#troubleshooting).

`make check 00 MISSION_TARGET=solution` runs the reference answer, `solution.ts` beside your start file, instead of your file: `Checking the TypeScript reference answer: typescript/missions/00-first-words/solution.ts`, the `[replay]` lines, `Tests  1 passed | 1 skipped (2)` and `PASS  TypeScript (tsc): typescript/missions/00-first-words/solution.ts typechecks`. No `PASS` block (vitest hides it on a pass) and no `Mission 00 passes` or `Next:` line (those are for your start file).

**Check yourself.** You change `PROMPT` in your start file, save, and run `make check 00` again. Does the check need your key?

<details>
<summary>Answer</summary>

No. The offline check replays a recorded conversation against your code on your machine; nothing reaches Deepgram. `make run 00` and `make live 00` are the two that do, and they need your key or a workshop token in `.env`.

</details>

## Run it in Docker

Prefer not to install Node.js or pnpm? Two ways, both with Docker on your own machine. Both need [Docker Desktop](https://docs.docker.com/get-started/get-docker/) (macOS, Windows, Linux) or Docker Engine with the Compose plugin (Linux); `docker compose version` tells you it is there.

- **VS Code:** install the Dev Containers extension, open this folder, and choose **Reopen in Container**. On Windows, choose **Dev Containers: Clone Repository in Container Volume** instead: the project then lives inside Docker, where it runs faster. It builds the same container Codespaces uses (`.devcontainer/`) and runs `make setup` for you. Put your key in `.env` and pick your language with `make use ts`.
- **Docker only:** `compose.yaml` and `Dockerfile` in this repo give you a container with Node.js 22, pnpm and make, on Debian 12 (bookworm), as root with no `sudo`. Paste these into a terminal, one at a time, in this order. The first two lines clone the repo and enter it; the rest run from that folder:

```sh
git clone https://github.com/deepgram-devs/voice-agent-workshop.git
cd voice-agent-workshop
docker compose run --rm workshop make setup SDK=ts   # once: builds the image, installs the harness and TypeScript, creates .env
docker compose run --rm workshop make use ts         # once: pick your language
docker compose run --rm workshop make check 00       # offline check: no key
```

Before the next two commands, open `.env` in this folder and put your key after `DEEPGRAM_API_KEY=` ([Your API key](#your-api-key)), or paste the two token lines from the workshop's `/code` page. A key exported in your shell does not reach the container: put it in `.env`.

```sh
docker compose run --rm workshop make run 00         # talk to your agent: type your turns. Needs the key or token
docker compose run --rm workshop make live 00        # live check against the real API. Needs the key or token
docker compose run --rm workshop                     # a shell inside the container, for anything else; exit leaves it
docker compose down -v                               # when you're done: removes the installs (the volumes). To come back, run the make setup line the next make check prints
```

No `git`? The ZIP works here too: download it as under Do this, `cd voice-agent-workshop-main`, and run the `docker compose` lines from there.

`make setup SDK=ts` (and any later pnpm install) may print pnpm's boxed `Update available!` notice, ending `To update, run: curl -fsSL https://get.pnpm.io/install.sh | sh -`. Ignore it: the pnpm in the image is fine, and that command would install pnpm on your machine for nothing. In the container the packages live in the `ts_modules` volume (Docker's named storage, outside the repo) mounted at `typescript/node_modules`.

Normal, every time:

- The first command builds the image before anything runs. After the volume and network lines (next bullet), Docker's build steps print (`#1`, `#2`, ... lines, then `Image voice-agent-workshop-workshop Built`): a few minutes and about 1 GB of downloads, so it needs the network. The image on disk is about 1.9 GB. Later runs start in a second or two.
- Every `docker compose run` prints two `Container voice-agent-workshop-workshop-run-... Creating` / `Created` lines first. The very first run, and the first run after `down -v`, also print `Volume ... Creating` / `Created` lines for the four volumes and the network, each twice.
- The prefix is the project name `compose.yaml` sets, so it is the same whatever your folder is called. A `-p` flag on the command changes it, and then every name above reads with yours in place of `voice-agent-workshop` (the image, the containers, the `docker rmi` below). No printed command carries a `-p` (the `Next:` lines, the `Run docker compose run --rm workshop make setup once` line, the "run ... again" lines), so add yours when you paste one.
- The repo is mounted into the container, so you edit files on your machine as usual. `.env`, `.workshop-lang` and `out/last-call.wav` are the files it writes in this folder, plus two empty folders where the volumes mount (`typescript/node_modules/` and `tools/replay-server/node_modules/`; Git ignores them). `down -v` leaves them all alone.
- `make check` runs offline with no key. `make run` and `make live` without a key or token stop with lines saying so (`make live` inside vitest's framing). Those lines, Docker Compose's own `.env` check and `Resource is still in use` after `down -v` are in the README's [Troubleshooting](../README.md#troubleshooting).
- `down -v` removes the volumes, not the image. The next `docker compose run` recreates them empty, so `make check` stops with `The check harness isn't installed. Run docker compose run --rm workshop make setup once, then this command again.` and `make: *** [Makefile:...: need-sdk] Error 2`.
- Run that line as printed. It is the plain `make setup`: it installs the harness and every track whose tool is in the image, so other tracks' install lines scroll by first. `make setup SDK=ts` installs the harness and TypeScript only; both work here.
- To get the space back as well: `docker rmi voice-agent-workshop-workshop`.

To pipe lines in, add `-T`: `printf 'hello\n' | docker compose run --rm -T workshop make run 00` (in PowerShell: `"hello" | docker compose run --rm -T workshop make run 00`). A container has no microphone or speakers: type your turns, then play `out/last-call.wav` on your machine. With Docker Engine on Linux (the usual rootful install), files and folders the container creates belong to root. From the project folder, `sudo chown -R "$(id -u):$(id -g)" .` gives them all back to you.

## Hear your agent

Every `make run` saves the agent's side of the call to `out/last-call.wav` when you hang up. So you can hear the voice, speed and greeting you picked. On a laptop, open it in any audio player (on macOS, `open out/last-call.wav`; on Linux, `xdg-open out/last-call.wav`; in WSL, `explorer.exe out`). A call that brought back no audio prints a `[no audio]` line instead and leaves the file as it was.

In Codespaces, a remote machine or a container, there is no audio device: type your turns as usual, then download the file. In Codespaces or VS Code, right-click `out/last-call.wav` in the Explorer and choose **Download**. Over SSH, copy it with `scp`. Each run writes a new `last-call.wav`, so download the one you want before the next run.

The microphone runs in one track only, and not this one: type your turns (every mission works typed) and listen to `out/last-call.wav`; [How a mission works](../README.md#how-a-mission-works) in the README has the one way to talk out loud. Wear headphones when you do: without them your agent hears itself through your speakers.

## Troubleshooting

Every one of these has happened to someone smart. The README's [Troubleshooting](../README.md#troubleshooting) has the rows every language hits; these are TypeScript's own. Find the line you see, read what it means, apply the fix, carry on.

| You see | What's happening | Fix |
|---|---|---|
| `pnpm: command not found` | pnpm isn't installed, or this terminal opened before you installed it. | Install it (Before you start, above), open a new terminal, and run `make setup SDK=ts` again. |
| `TypeScript isn't set up in this folder yet (make setup never installed it). Run make setup SDK=ts once, then this command again.` (then `make: *** [Makefile:...: need-sdk] Error 2`) | You ran `make check` (or `run`, `live`) for TypeScript, with `SDK=ts` or because TypeScript is your saved language, in a project where `make setup` never installed it (`make setup SDK=py` was the only setup, say). In Docker the line names `docker compose run --rm workshop make setup SDK=ts`. | Run the `make setup SDK=ts` the line gives, once. |
| `TypeScript needs pnpm` | TypeScript is your language and pnpm isn't installed. | Install it (Before you start, above), open a new terminal, and run `make setup`. |
| `Skipping TypeScript: it needs pnpm (npm install -g pnpm@10).` during `make setup` | Plain `make setup` found no pnpm. With TypeScript your language, setup then ends on `TypeScript needs pnpm` (the row above). | Install pnpm (Before you start, above), open a new terminal, and run `make setup` again. |
| `FAIL  TypeScript (tsc) found type errors in typescript/missions/...:`, `Your file has a TypeScript type error ... a cast is not the fix, unless the mission's brief shows one.`, then `missions/06-encore/start.ts(19,7): error TS2322: Type 'string' is not assignable to type 'number'.`, say | The check typechecks your start file too and found a value of the wrong type (a `TS2xxx` code, or a five-digit one such as `TS18046`). The constant carries a type (`SPEED: number` in mission 06, say), so tsc points at the value on the constant's own line (19 is the unedited file's line). | Give the value the type the TODO comment names (a number for a limit, a string for a voice); never a cast (`as string`: telling the compiler to trust you), except the one pre-written at mission 01's TODO 3 for `event.functions`. Then run `make check NN` again. |
| The same two lines, with the error on a line below the constant: `missions/00-first-words/start.ts(24,10): error TS2352: Conversion of type '{ audio: ...' to type 'Settings' may be a mistake ...` in mission 00 | The constant carries no type (mission 00's `VOICE`, `PROMPT` and `GREETING`), so tsc points at the first place the value is used: the `return {` line that `buildSettings()` casts `as Settings`, seven lines below the value in the unedited file. | The same: fix the value, no cast. The replay above says which TODO (`FAIL  TODO 2: you picked a voice other than flux-hannah-en` for `VOICE = 42`). |
| `... convert the expression to 'unknown' first`, and three more lines naming `agent.speak`, under that TS2352 line | The cast tsc proposes is the one the line above warns against; the three lines say which field is wrong. | Ignore the `unknown` suggestion; fix the value. |
| The same two lines, then `error TS2304: Cannot find name 'True'.` (mission 05, `SURPRISE_ME = True`) | A misspelling. The type-error line prints for every code outside `TS1xxx`, so it warns against a cast where none is at stake. | Fix the spelling (`true`), then run `make check NN` again. |
| `FAIL  TypeScript (tsc) found type errors in typescript/missions/...:` then `Your file has a TypeScript syntax error (line and column below). Fix it, then run make check NN again.` | A bracket, brace or quote never closed: a four-digit `TS1xxx` code. vitest prints its own `[PARSE_ERROR]` dump first. For a plain quote, bracket or brace, both name the same line (vitest's column is where the string opens, tsc's where the line ends). | Close the bracket or quote. Then run `make check NN` again (in Docker the printed command carries the `docker compose run --rm workshop make` prefix). |
| The same two lines after you break a backtick (a template literal, as mission 03's `Added "${text}"` uses): vitest's `[PARSE_ERROR] Expected a semicolon or an implicit semicolon after a statement, but found none`, then up to twenty tsc lines, the first `error TS1005: ';' expected.` | The broken literal runs on to the next backtick in the file, so both point at that later line, not at your mistake, and everything after it misparses. (`error TS1160: Unterminated template literal.` on the file's last line prints only when the broken one is the last backtick in the file.) | Look above the line they name for the backtick that never closed, and close it. Then run `make check NN` again. |
| `FAIL  TypeScript (tsc): typescript/<file> has a syntax error, and tsc checks no file while any file has one. Fix that file first (make check NN names the line), then run make check MM again.` in place of the `PASS  TypeScript (tsc)` line, with no type-error block | tsc reads the whole `typescript/` folder (`src`, `missions`, `examples`) and reports no type errors at all while any file in it has a syntax error, so your file's typecheck was not a pass. One line per broken file; a type error in another file does not do this. | Fix the file it names, then run the command the line gives. The parenthetical prints for a mission's start file only, whose `make check` shows the line and column; for a file under `src/` or `examples/` no `make check` does, so open it and undo your last edit. |
| `DEEPGRAM_API_KEY has a character a key can't have` after you put quotes around the key (TypeScript never prints `.env line N couldn't be read`) | TypeScript's `.env` parser keeps a quote in the value when it never closes or has words after it, and a key can't hold a quote or a space. In Docker an unclosed quote usually stops at Compose first (the README's `unterminated quoted value` row); one word after a closing quote reaches this line. | Write the line as `DEEPGRAM_API_KEY=your_key`, no quotes. |
| A key you know is right prints `has a character a key can't have`, and `.env` was saved by an editor that asked about encoding | TypeScript reads a non-UTF-8 `.env` with replacement characters: a bad byte in the key prints this line, one in a comment goes unnoticed (`.env isn't UTF-8 text` is the other tracks' line). | Save `.env` as UTF-8 (plain text) in your editor, then run it again. |
| `Could not reach the agent: connection refused. Check DEEPGRAM_AGENT_URL.` on `make run` (`... Check WORKSHOP_URL. Is the workshop site up?` with a token), then `make: *** [Makefile:...: run] Error 2`; in `make live`, `FAIL  Could not reach production: ...` in vitest's `CheckFailed:` block | Nothing answered, or the address did not resolve: venue wifi, a proxy, a VPN, or a wrong `DEEPGRAM_AGENT_URL`. In place of `connection refused`, the line says `no such host` or `it timed out`. With a token those end `Check WORKSHOP_URL.` with no question after it. | Leave `DEEPGRAM_AGENT_URL` empty for production; if it is, try a phone hotspot. `make check NN` needs no network. The README's [Troubleshooting](../README.md#troubleshooting) has the three rows (`custom endpoint` or `workshop proxy` in place of `production` for another address or a token). |
| `You installed esbuild for another platform` | The installs came from another system (Windows and WSL in one folder, say). | Run `rm -rf typescript/node_modules tools/replay-server/node_modules`, then `make setup`, in the terminal you work in. |
| `MIC=1 runs in Python: make run NN SDK=py MIC=1 (add MISSION_TARGET=solution to use the reference answer)` (in Docker, `No microphone in a container. Type your turns: make run NN (Docker: docker compose run --rm workshop make run NN)` prints instead) | You added `MIC=1`; the microphone runs in one track only, and not this one. | Type your turns, or run the command the line gives. |

## Keep going

The missions are in the README: [Missions](../README.md#missions), then [Keep going](../README.md#keep-going). Three TypeScript things to know on the way:

- **The smallest program, with no helpers:** `pnpm tsx examples/first-settings.ts` (from `typescript/`; in Docker, `docker compose run --rm workshop sh -c 'cd typescript && pnpm tsx examples/first-settings.ts'`). It sends Settings, waits for `SettingsApplied`, lets you type turns and saves the agent's voice to `out/last-call.wav`. With no key it stops on `DEEPGRAM_API_KEY is empty in .env (this folder). Set it: this example runs on your own key only (make run takes a workshop token too). make check NN runs offline with no key.` (`NN`: the example has no check). Nothing answering at `DEEPGRAM_AGENT_URL` prints `Could not reach the agent: connection refused. Check DEEPGRAM_AGENT_URL.` (`no such host` or `it timed out` for another failure), as `make run` does, exit code 2.
- **Staying connected.** `run` ends when the connection drops. For a program you'll leave running, use `runResilient` (`src/resilient.ts`) in its place: it reconnects with a growing wait, sends your Settings again on every new connection, and prints each close code ([Staying connected](../README.md#staying-connected) says when it stops).

  ```ts
  import { runResilient } from '../../src/resilient.js';
  await runResilient({ buildSettings, onEvent });
  ```

- **Coming from SDK v3?** The pin is `@deepgram/sdk` 5.14.0, with `new DeepgramClient(...)` and `client.agent.v1.connect()`. v3's agent websocket client and its `.on(...)` event names are gone, so v3 code won't run on this pin. `make check` names each earlier field it finds in your Settings or your code, and the field to use now. It also typechecks your start file and fails on a type error; the fix is to give the value the type the TODO comment names, never to cast it. Mission 01's `event.functions` is the one exception: the cast is pre-written in its start file, and its brief says so. [Coming from SDK v3](../README.md#coming-from-sdk-v3) has the renamed fields.
