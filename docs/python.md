# Python

**Goal:** mission 00's check running and naming the first TODO for you, in about five minutes (the Docker way adds the image build, a few minutes the first time). On your own machine that means installing uv, plus Node.js and make for the checks; Codespaces and Docker bring all three.

**You'll learn**

- What gets installed, and why Node.js is needed even for Python (it runs the checks)
- Where your key lives (`.env` in the project folder) and which commands need it
- What a failing and a passing check look like, so you recognize them later

Want TypeScript or Java instead? See [TypeScript](typescript.md) or [Java](java.md).

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
- **uv**, the Python package manager ([install page](https://docs.astral.sh/uv/getting-started/installation/)). It installs Python 3.12 for you if needed (3.10 or newer works), so it doesn't matter which Python your machine has. One command (`curl -LsSf https://astral.sh/uv/install.sh | sh` on macOS and Linux; on Fedora, `sudo dnf install uv` works too), then reopen your terminal so `uv` is on your PATH (the list of folders your terminal searches for commands), and check:

  ```sh
  uv --version
  ```

**Can't install anything?** Work laptop, Chromebook, IT policies: run the whole workshop in GitHub Codespaces, free.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/deepgram-devs/voice-agent-workshop)

That opens an editor and a terminal in the browser, with Node.js, uv and make installed and `make setup` already run. From there:

1. Skip `git clone` and `make setup`: you are inside the project and it is set up.
2. Run `make use py`.
3. Go to [Check that it works](#check-that-it-works): the offline check needs no key.
4. Before `make run`, add your key (or the two token lines) to `.env` (see [Your API key](../README.md#your-api-key)).

A codespace has no microphone or speakers: type your turns and download the agent's voice to listen (see [Hear your agent](#hear-your-agent)). VS Code's Dev Containers uses the same setup (`.devcontainer/`).

## Do this

Docker instead? Skip to [Run it in Docker](#run-it-in-docker); it has its own clone line.

Paste these into your terminal, one at a time:

```sh
git clone https://github.com/deepgram-devs/voice-agent-workshop.git
cd voice-agent-workshop
make setup SDK=py
```

`SDK=py` installs the **check harness** and Python, and creates `.env`. The check harness is the Node.js program under `tools/replay-server/` that replays recorded conversations against your code for `make check`. Its own install prints first (`npm ci`, then `added 1 package`), then uv's lines (`Resolved ... packages`, `Installed ... packages`, one line per package); the first time, it ends with:

```text
Created .env: at the workshop, paste the two WORKSHOP_ lines from the /code page into it; at home, put your DEEPGRAM_API_KEY in it
Pick your language first: make use py (Python), make use ts (TypeScript) or make use java (Java)
```

Run it again later (a Troubleshooting row says to, or you come back to Docker after `down -v`) and uv prints lines like `Resolved 29 packages in 1ms` and `Checked 21 packages in 3ms` in place of its install lines; with your language picked, it ends with `Your language: Python (saved in .workshop-lang). To switch: make use ts or make use java` instead.

No `git` on your machine? Download the ZIP instead: green **Code** button, **Download ZIP** on the [repo page](https://github.com/deepgram-devs/voice-agent-workshop). Unzip it, `cd` into the folder it makes (`voice-agent-workshop-main`), and run `make setup SDK=py` there.

Then pick your language, once:

```sh
make use py
```

It prints `Saved: Python. make check, run and live use it now. Add SDK=ts to run one command in TypeScript.` From then on `make check`, `make run` and `make live` use Python and name the file they work on; the choice is saved in `.workshop-lang` (Git ignores it). [Pick a language](../README.md#pick-a-language) in the README covers switching.

## Your API key

The offline check below needs no key. Before `make run` or `make live`, open `.env` in the project folder (`make setup` created it), find the line `DEEPGRAM_API_KEY=` and put your key after the `=`, with no quotes or spaces; or paste the workshop's two token lines. [Your API key](../README.md#your-api-key) in the README says where a key comes from and how a Codespaces secret works, the same for every language.

## Check that it works

```sh
make check 00            # offline: no key, no network, a few seconds
```

This one fails on purpose: you haven't done mission 00 yet. The command prints `Checking your Python file: python/missions/00-first-words/start.py`, then pytest, Python's test runner, prints `F`, then `[100%]` at the end of that line, and a `FAILURES` heading. In the middle of the output is this block. It has a `PASS` line for each part the start file already has, a `FAIL` line for each open TODO, then the file and line to open:

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
Your file: python/missions/00-first-words/start.py:13 (TODO 1)
```

If you see the `Your file:` line, everything is installed. After the block: `Captured stdout call` with the `[replay]` lines, then `1 failed, 1 deselected`, and the `make: *** [Makefile:...: check] Error 1` under it is the failing check, which is the point. Open the file it names and start [mission 00](../missions/00-first-words/README.md); when its checks pass, come back to the README's [missions table](../README.md#missions) for the rest ([How a mission works](../README.md#how-a-mission-works) there is the reference for the three commands).

Once every TODO passes, the summary reads `1 passed, 1 deselected`, then two lines. First `Mission 00 passes its offline check: python/missions/00-first-words/start.py`, then the next step: `Next: make run 00 to talk to your agent (type a line, press Enter; Ctrl-D or Ctrl-C hangs up). It needs DEEPGRAM_API_KEY or your workshop token in .env. Then make live 00 runs the live check.` Missions with two recorded calls (02 to 05) end `2 passed, 1 deselected` instead.

In Docker, each `make` in the `Next:` line reads `docker compose run --rm workshop make`. With `WORKSHOP_URL` in `.env`, two more lines name the mission's page on the workshop site and the checkpoint to tick there, **I did this** on **Your code passed make check NN** ([At the workshop or remote](../README.md#at-the-workshop-or-remote)). Anything else, a setup error say, is under [Troubleshooting](#troubleshooting).

`make check 00 MISSION_TARGET=solution` runs the reference answer, `solution.py` beside your start file, instead of your file. It prints `Checking the Python reference answer: python/missions/00-first-words/solution.py`, a `.` and `1 passed, 1 deselected`, and nothing else: pytest hides the `PASS` lines on a pass, and the `Mission 00 passes` and `Next:` lines are for your start file.

**Check yourself.** You change `PROMPT` in your start file, save, and run `make check 00` again. Does the check need your key?

<details>
<summary>Answer</summary>

No. The offline check replays a recorded conversation against your code on your machine; nothing reaches Deepgram. `make run 00` and `make live 00` are the two that do, and they need your key or a workshop token in `.env`.

</details>

## Run it in Docker

Prefer not to install Node.js or uv? Two ways, both with Docker on your own machine. Both need [Docker Desktop](https://docs.docker.com/get-started/get-docker/) (macOS, Windows, Linux) or Docker Engine with the Compose plugin (Linux); `docker compose version` tells you it is there.

- **VS Code:** install the Dev Containers extension, open this folder, and choose **Reopen in Container**. On Windows, choose **Dev Containers: Clone Repository in Container Volume** instead: the project then lives inside Docker, where it runs faster. It builds the same container Codespaces uses (`.devcontainer/`) and runs `make setup` for you. Put your key in `.env` and pick your language with `make use py`.
- **Docker only:** `compose.yaml` and `Dockerfile` in this repo give you a container with Node.js 22, Python 3.12 with uv and make, on Debian 12 (bookworm), as root with no `sudo`. Paste these into a terminal, one at a time, in this order. The first two lines clone the repo and enter it; the rest run from that folder:

```sh
git clone https://github.com/deepgram-devs/voice-agent-workshop.git
cd voice-agent-workshop
docker compose run --rm workshop make setup SDK=py   # once: builds the image, installs the harness and Python, creates .env
docker compose run --rm workshop make use py         # once: pick your language
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

The first Python `make setup` prints uv's lines before its result, lines like `Using CPython 3.12...`, `Creating virtual environment at: /opt/venv`, `Resolved ... packages`, `Building voice-agent-workshop @ file:///workspace/python`, `Downloading pygments (1.2MiB)` and ` Downloaded ...` for some packages, `Built ...`, `Prepared ... packages`, `Installed ... packages` and one line per package. A later Python `make check` prints them again only when uv has to refresh the project (after a `git pull`, say); most runs print none of them. In the container the Python environment is `/opt/venv` (a volume: Docker's named storage, outside the repo), not `python/.venv`.

Normal, every time:

- The first command builds the image before anything runs. After the volume and network lines (next bullet), Docker's build steps print (`#1`, `#2`, ... lines, then `Image voice-agent-workshop-workshop Built`): a few minutes and about 1 GB of downloads, so it needs the network. The image on disk is about 1.9 GB. Later runs start in a second or two.
- Every `docker compose run` prints two `Container voice-agent-workshop-workshop-run-... Creating` / `Created` lines first. The very first run, and the first run after `down -v`, also print `Volume ... Creating` / `Created` lines for the four volumes and the network, each twice.
- The prefix is the project name `compose.yaml` sets, so it is the same whatever your folder is called. A `-p` flag on the command changes it, and then every name above reads with yours in place of `voice-agent-workshop` (the image, the containers, the `docker rmi` below). No printed command carries a `-p` (the `Next:` lines, the `Run docker compose run --rm workshop make setup once` line, the "run ... again" lines), so add yours when you paste one.
- The repo is mounted into the container, so you edit files on your machine as usual. `.env`, `.workshop-lang` and `out/last-call.wav` are the files it writes in this folder, plus two empty folders where the volumes mount (`typescript/node_modules/` and `tools/replay-server/node_modules/`; Git ignores them). `down -v` leaves them all alone.
- `make check` runs offline with no key. `make run` and `make live` without a key or token stop with lines saying so (`make live` inside pytest's framing). Those lines, Docker Compose's own `.env` check and `Resource is still in use` after `down -v` are in the README's [Troubleshooting](../README.md#troubleshooting).
- `down -v` removes the volumes, not the image. The next `docker compose run` recreates them empty, so `make check` stops with `The check harness isn't installed. Run docker compose run --rm workshop make setup once, then this command again.` and `make: *** [Makefile:...: need-sdk] Error 2`.
- Run that line as printed. It is the plain `make setup`: it installs the harness and every track whose tool is in the image, so other tracks' install lines scroll by first, including pnpm's boxed `Update available!` notice ending `curl -fsSL https://get.pnpm.io/install.sh | sh -`. Ignore that: nothing here asks you to update anything, and the pnpm in the image is fine. `make setup SDK=py` installs the harness and Python only; both work here.
- To get the space back as well: `docker rmi voice-agent-workshop-workshop`.

To pipe lines in, add `-T`: `printf 'hello\n' | docker compose run --rm -T workshop make run 00` (in PowerShell: `"hello" | docker compose run --rm -T workshop make run 00`). A container has no microphone or speakers, so `MIC=1` doesn't work there: type your turns, then play `out/last-call.wav` on your machine. With Docker Engine on Linux (the usual rootful install), files and folders the container creates belong to root. From the project folder, `sudo chown -R "$(id -u):$(id -g)" .` gives them all back to you.

## Hear your agent

Every `make run` saves the agent's side of the call to `out/last-call.wav` when you hang up. So you can hear the voice, speed and greeting you picked. On a laptop, open it in any audio player (on macOS, `open out/last-call.wav`; on Linux, `xdg-open out/last-call.wav`; in WSL, `explorer.exe out`). A call that brought back no audio prints a `[no audio]` line instead and leaves the file as it was.

In Codespaces, a remote machine or a container, there is no audio device: type your turns as usual, then download the file. In Codespaces or VS Code, right-click `out/last-call.wav` in the Explorer and choose **Download**. Over SSH, copy it with `scp`. Each run writes a new `last-call.wav`, so download the one you want before the next run.

On your own machine, Python can also use your microphone and speakers: `make run 00 MIC=1` (it installs the audio extra the first time; on Linux it needs PortAudio, the library that opens your microphone: `sudo apt install libportaudio2` or `sudo dnf install portaudio`). Wear headphones: without them your agent hears itself through your speakers, and your neighbor's agent too, and everyone's conversation gets weird. No headphones? Type your turns and keep the volume low; every mission works typed.

## Troubleshooting

Every one of these has happened to someone smart. The README's [Troubleshooting](../README.md#troubleshooting) has the rows every language hits (the credentials lines, the `.env` lines, the first failing check); these are Python's own. Find the line you see, read what it means, apply the fix, carry on.

| You see | What's happening | Fix |
|---|---|---|
| `uv: command not found` | uv isn't installed, or this terminal opened before you installed it. | Install it (Before you start, above), open a new terminal, and run `make setup SDK=py` again. |
| `Python needs uv` | Python is your language and uv isn't installed. | Install it (Before you start, above), open a new terminal, and run `make setup`. |
| `Skipping Python: it needs uv (https://docs.astral.sh/uv/).` during `make setup` | Plain `make setup` found no uv. With Python your language, setup then ends on `Python needs uv` (the row above). | Install uv (Before you start, above), open a new terminal, and run `make setup` again. |
| `.env line N couldn't be read` | A quote on line N never closes or has words after it, or the line isn't `KEY=value`. On the key's line, the `is empty` line follows it: fix line N, not the key. On `make run` it prints first; `make check` and `make live` show it inside pytest's `Captured stderr call` on a failing check. | Write the line as `KEY=value`, no quotes. In Docker, Compose usually stops on these lines first: the two `failed to read` rows in the README's [Troubleshooting](../README.md#troubleshooting). One word after a closing quote gets through and reaches this row. |
| `Your Python file doesn't run: python/missions/...:LINE SyntaxError` | A syntax error at that line (a bracket or quote never closed, a missing colon). The same line with `NameError: name 'true' is not defined` means `true` instead of `True`; that one comes inside pytest's `ERROR collecting` lines. | Fix it and run `make check NN` again (in Docker the line's command carries the `docker compose run --rm workshop make` prefix). |
| A `FAIL  TODO n:` line with `RuntimeWarning: coroutine 'Agent....' was never awaited` at the bottom of the output, under pytest's `warnings summary` | An `agent.` call ran without `await`, so nothing was sent. Every `agent.` method is `async`. | Put `await` in front of it: `await agent.update_prompt(...)`, `await agent.close()`. The mission's TODO comment shows the call with `await`. |
| `[note] Settings sent as raw JSON: this SDK release has no field for part of it (the check reads it the same)`, the first line of pytest's `Captured stdout call` on a failing check, or, on a `make run` that connects, the line between `Running your Python file:` and `[ready]` | The pinned `deepgram-sdk` 7.12.0 could not model your Settings, so the helpers sent the same JSON raw. Two causes: `THINKING_MODEL` set in `.env` (mission 03's `thinking` stretch: the SDK has no model for that provider), or a decimal `EXPRESSIVITY` in mission 06 (`1.5`, or `1.0`). | Nothing to change for the stretch. In mission 06, write a whole number (`1`, not `1.0`): the SDK's field takes nothing else. The check reads the JSON either way, so `1.5` also fails TODO 3 and `1.0` passes it; `SPEED` never prints this line. |
| `Could not reach the agent: connection refused. Check DEEPGRAM_AGENT_URL.` on `make run` (`... Check WORKSHOP_URL. Is the workshop site up?` with a token), then `make: *** [Makefile:...: run] Error 2`; in `make live`, `FAIL  Could not reach production: ...` inside pytest's failure output | Nothing answered, or the address did not resolve: venue wifi, a proxy, a VPN, or a wrong `DEEPGRAM_AGENT_URL`. Other details here: the system's words (`Name or service not known` on Linux and in Docker, `nodename nor servname provided, or not known` on macOS) or `TimeoutError`. | Leave `DEEPGRAM_AGENT_URL` empty for production; if it is, try a phone hotspot. `make check NN` needs no network. The README's [Troubleshooting](../README.md#troubleshooting) has the three rows (`custom endpoint` or `workshop proxy` in place of `production` for another address or a token). |
| `MIC=1 uses the PortAudio library` | The library isn't installed. | Run the install command the message gives (`sudo apt install libportaudio2` or `sudo dnf install portaudio`), or drop `MIC=1` and type your turns. |

## Keep going

The missions are in the README: [Missions](../README.md#missions), then [Keep going](../README.md#keep-going). Three Python things to know on the way:

- **The smallest program, with no helpers:** `uv run python examples/first_settings.py` (from `python/`; in Docker, `docker compose run --rm workshop sh -c 'cd python && uv run python examples/first_settings.py'`). It sends Settings, waits for `SettingsApplied`, lets you type turns and saves the agent's voice to `out/last-call.wav`. With no key it stops on `DEEPGRAM_API_KEY is empty in .env (this folder). Set it: this example runs on your own key only (make run takes a workshop token too). make check NN runs offline with no key.` (`NN`: the example has no check). Nothing answering at `DEEPGRAM_AGENT_URL` prints `Could not reach the agent: connection refused. Check DEEPGRAM_AGENT_URL.`, as `make run` does; a scheme-less address still ends in a traceback.
- **Staying connected.** `run` ends when the connection drops. For a program you'll leave running, use `run_resilient` (`agent/resilient.py`) in its place: it reconnects with a growing wait, sends your Settings again on every new connection, and prints each close code ([Staying connected](../README.md#staying-connected) says when it stops).

  ```python
  from agent.resilient import run_resilient
  run_resilient(build_settings, on_event)
  ```

- **Coming from SDK v3?** The pin is `deepgram-sdk` 7.12.0. You make an `AsyncDeepgramClient`, open the agent with `async with client.agent.v1.connect() as socket`, then read events with `async for`. v3's agent websocket client and its `.on(...)` event names are gone, so v3 code won't run on this pin. Install into a fresh environment (`make setup` makes one in `python/.venv`; in Docker, `/opt/venv`), not one that already has v3. [Coming from SDK v3](../README.md#coming-from-sdk-v3) has the renamed fields.
