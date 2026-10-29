# Java

**Goal:** mission 00's check running and naming the first TODO for you, in about five minutes (the Docker way adds the image build, a few minutes the first time). On your own machine that means installing a JDK, plus Node.js and make for the checks (Maven comes with the project). Codespaces brings Node.js and make, and one `apt` line adds the JDK; Docker's `workshop-java` service brings all three.

**You'll learn**

- What gets installed, and why Node.js is needed even for Java (it runs the checks)
- Where your key lives (`.env` in the project folder) and which commands need it
- What a failing and a passing check look like, so you recognize them later

Want Python or TypeScript instead? See [Python](python.md) or [TypeScript](typescript.md).

Every mission runs in Java on Deepgram's Java SDK (`com.deepgram:deepgram-java-sdk` 0.11.1), with the same checks as the other tracks. Mission NN's start file is `java/missions/mNN_name/Start.java`, with the reference answer beside it in `Solution.java`. Java runs on macOS and Linux, on Windows in WSL, in GitHub Codespaces, in the dev container and in Docker (its own service, `workshop-java`); you type your turns.

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
- **A JDK (Java Development Kit) 17 or newer.** Install one: on macOS, with Homebrew ([brew.sh](https://brew.sh)), `brew install --cask temurin@21`; on Ubuntu 24.04, `sudo apt update && sudo apt install openjdk-21-jdk`; on Debian 12, `sudo apt update && sudo apt install openjdk-17-jdk` (17 is enough); on Fedora, `sudo dnf install java-21-openjdk-devel`; or download Temurin 21 (Adoptium's free build) from [adoptium.net](https://adoptium.net). Maven (Java's build tool) comes with the project as `java/mvnw`. Reopen your terminal, then check:

  ```sh
  javac -version
  ```

  If that prints `javac 17` or higher, you're set. The checks need `javac`, which comes with a JDK; a JRE (Java Runtime Environment, the kind that only runs programs) has `java` only.

**Can't install anything?** Work laptop, Chromebook, IT policies: run the whole workshop in GitHub Codespaces, free.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/deepgram-devs/voice-agent-workshop)

That opens an editor and a terminal in the browser, with Node.js and make installed and `make setup` already run, but no JDK. From there:

1. Skip `git clone`: you are inside the project.
2. One `apt` line (the package installer on Debian and Ubuntu): `sudo apt-get update && sudo apt-get install -y openjdk-21-jdk-headless` (under a minute). That line is for the codespace's Debian 13 (trixie) image, which `.devcontainer/devcontainer.json` pins (`-headless`: no desktop parts).
3. `make use java`, then `make setup` (it builds the Java helpers and fetches the SDK, as under Do this).
4. Go to [Check that it works](#check-that-it-works): the offline check needs no key.
5. Before `make run`, add your key (or the two token lines) to `.env` (see [Your API key](../README.md#your-api-key)).

A codespace has no microphone or speakers: type your turns and download the agent's voice to listen (see [Hear your agent](#hear-your-agent)). VS Code's Dev Containers uses the same setup (`.devcontainer/`), with the same `apt` line.

## Do this

Docker instead? Skip to [Run it in Docker](#run-it-in-docker); it has its own clone line.

Paste these into your terminal, one at a time:

```sh
git clone https://github.com/deepgram-devs/voice-agent-workshop.git
cd voice-agent-workshop
make use java
make setup
```

`make use java` goes first, so plain `make setup` knows to build Java. It installs the **check harness**, the Node.js program under `tools/replay-server/` that replays recorded conversations against your code for `make check`. Then it builds the Java helpers and fetches the SDK: `[setup] Building the Java helpers and fetching the SDK: about a minute, the first time.` Maven downloads quietly, so a still screen for up to a minute is normal. It also installs any other track whose tool is on your machine, so a few install lines from them may scroll by; `make setup SDK=java` installs Java only. It creates `.env`, and because Java is already picked it ends with your language instead of the pick line:

```text
Created .env: at the workshop, paste the two WORKSHOP_ lines from the /code page into it; at home, put your DEEPGRAM_API_KEY in it
Your language: Java (saved in .workshop-lang). To switch: make use py or make use ts
```

Run `make setup` again later and it prints `[setup] The Java helpers are built.` and skips the build; if the SDK's jars have gone (a cleared `~/.m2`, a clone moved to another machine, Docker's `down -v`), it prints the `[setup] Building the Java helpers and fetching the SDK` line again and fetches them.

`make use java` printed `Saved: Java. make check, run and live use it now. Add SDK=py to run one command in Python.`: from then on `make check`, `make run` and `make live` use Java and name the file they work on; the choice is saved in `.workshop-lang` (Git ignores it). [Pick a language](../README.md#pick-a-language) in the README covers switching.

No `git` on your machine? Download the ZIP instead: green **Code** button, **Download ZIP** on the [repo page](https://github.com/deepgram-devs/voice-agent-workshop). Unzip it, `cd` into the folder it makes (`voice-agent-workshop-main`), and run `make use java` and `make setup` there.

## Your API key

The offline check below needs no key. Before `make run` or `make live`, open `.env` in the project folder (`make setup` created it), find the line `DEEPGRAM_API_KEY=` and put your key after the `=`, with no quotes or spaces; or paste the workshop's two token lines. [Your API key](../README.md#your-api-key) in the README says where a key comes from and how a Codespaces secret works, the same for every language.

## Check that it works

```sh
make check 00            # offline: no key, no network, a few seconds
```

This one fails on purpose: you haven't done mission 00 yet. The command prints `Checking your Java file: java/missions/m00_first_words/Start.java`, then the checker's `[replay]` lines, `replay: greeting did not pass:` and `00-first-words replay "greeting"`, then this block. It has a `PASS` line for each part the start file already has, a `FAIL` line for each open TODO, then the file and line to open:

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
Your file: java/missions/m00_first_words/Start.java:21 (TODO 1)
```

If you see the `Your file:` line, everything is installed. After the block: `1 failed, 0 passed`, and the `make: *** [Makefile:...: check] Error 1` under it is the failing check, which is the point. Each mission compiles on its own, in about a second after the first build. Open the file it names and start [mission 00](../missions/00-first-words/README.md); when its checks pass, come back to the README's [missions table](../README.md#missions) for the rest ([How a mission works](../README.md#how-a-mission-works) there is the reference for the three commands).

Once every TODO passes: `1 passed`, then two lines. First `Mission 00 passes its offline check: java/missions/m00_first_words/Start.java`, then the next step: `Next: make run 00 to talk to your agent (type a line, press Enter; Ctrl-D or Ctrl-C hangs up). It needs DEEPGRAM_API_KEY or your workshop token in .env. Then make live 00 runs the live check.` Missions with two recorded calls (02 to 05) end `2 passed` instead.

In Docker, each `make` in the `Next:` line reads `docker compose run --rm workshop-java make`. With `WORKSHOP_URL` in `.env`, two more lines name the mission's page on the workshop site and the checkpoint to tick there, **I did this** on **Your code passed make check NN** ([At the workshop or remote](../README.md#at-the-workshop-or-remote)). Anything else, a setup error say, is under [Troubleshooting](#troubleshooting).

`make check 00 MISSION_TARGET=solution` runs the reference answer, `Solution.java` beside your start file, instead of your file: `Checking the Java reference answer: java/missions/m00_first_words/Solution.java`, the replay, `1 passed`, with no `Mission 00 passes` or `Next:` line (those are for your start file).

**Check yourself.** You change `PROMPT` in your start file, save, and run `make check 00` again. Does the check need your key?

<details>
<summary>Answer</summary>

No. The offline check replays a recorded conversation against your code on your machine; nothing reaches Deepgram. `make run 00` and `make live 00` are the two that do, and they need your key or a workshop token in `.env`.

</details>

## Run it in Docker

Prefer not to install a JDK? Two ways, both with Docker on your own machine. Both need [Docker Desktop](https://docs.docker.com/get-started/get-docker/) (macOS, Windows, Linux) or Docker Engine with the Compose plugin (Linux); `docker compose version` tells you it is there.

- **VS Code:** install the Dev Containers extension, open this folder, and choose **Reopen in Container**. On Windows, choose **Dev Containers: Clone Repository in Container Volume** instead: the project then lives inside Docker, where it runs faster. It builds the same container Codespaces uses (`.devcontainer/`) and runs `make setup` for you. Then the one `apt` line from Before you start, `make use java`, `make setup`, and your key in `.env`.
- **Docker only:** `compose.yaml` and `Dockerfile` in this repo give you a container with Node.js 22 and make, on Debian 12 (bookworm), as root with no `sudo`. The `workshop-java` service is that image plus `openjdk-17-jdk-headless` from Debian 12's packages (the Dockerfile's `JDK` build arg). Paste these into a terminal, one at a time, in this order. The first two lines clone the repo and enter it; the rest run from that folder:

```sh
git clone https://github.com/deepgram-devs/voice-agent-workshop.git
cd voice-agent-workshop
docker compose run --rm workshop-java make use java   # once: builds the image with a JDK 17 (a few minutes), then picks your language
docker compose run --rm workshop-java make setup      # once: the harness, the Java helpers and the other tracks in the image; creates .env
docker compose run --rm workshop-java make check 00   # offline check: no key
```

Before the next two commands, open `.env` in this folder and put your key after `DEEPGRAM_API_KEY=` ([Your API key](#your-api-key)), or paste the two token lines from the workshop's `/code` page. A key exported in your shell does not reach the container: put it in `.env`.

```sh
docker compose run --rm workshop-java make run 00     # talk to your agent: type your turns. Needs the key or token
docker compose run --rm workshop-java make live 00    # live check against the real API. Needs the key or token
docker compose run --rm workshop-java                 # a shell inside the container, for anything else; exit leaves it
docker compose down -v                                # when you're done: removes the installs (the volumes). To come back, run the make setup line the next make check prints
```

No `git`? The ZIP works here too: download it as under Do this, `cd voice-agent-workshop-main`, and run the `docker compose` lines from there.

In the container, plain `make setup` installs every track whose tool is in the image, so other tracks' install lines print first, including a boxed `Update available!` notice ending `To update, run: curl -fsSL https://get.pnpm.io/install.sh | sh -`: ignore it, the tool in the image is fine. Then `cd java && sh mission.sh setup`, `[setup] Building the Java helpers and fetching the SDK: about a minute, the first time.` (quietly), and it ends with `Your language: Java (saved in .workshop-lang). To switch: make use py or make use ts`.

`make setup SDK=java` installs the harness and Java only.

Maven's download lives in the `home` volume (Docker's named storage, outside the repo), so `down -v` removes it; the next `make setup` prints the `[setup] Building ... fetching the SDK` line again and fetches it. `java/target/` is written into the mounted repo.

The plain `workshop` service has no JDK. `make use java` there prints `Saved: Java. ...`, then `The Docker image has no JDK. For Java in Docker, use the workshop-java service (docker compose run --rm workshop-java make use java, then make setup); or VS Code Dev Containers, GitHub Codespaces, or your own machine (README: Java).`, and exits 0. From then on, with Java saved, `make check`, `make run`, `make live` and `make setup` there stop with the same command on the other service, for example `The Docker image has no JDK, and Java is your language: run this same command with workshop-java in place of workshop (docker compose run --rm workshop-java make check 00); or VS Code Dev Containers, GitHub Codespaces, or your own machine (README: Java).` A brief's `docker compose run --rm workshop make check 00` line, pasted from the Java track, lands here: run the command the line gives.

Normal, every time:

- The first command builds the image before anything runs. After the volume and network lines (next bullet), Docker's build steps print (`#1`, `#2`, ... lines, then `Image voice-agent-workshop-workshop-java Built`): a few minutes and about 1 GB of downloads, so it needs the network. The Java image adds about 430 MB for the JDK; on disk it is about 2.3 GB. Later runs start in a second or two.
- Every `docker compose run` prints two `Container voice-agent-workshop-workshop-java-run-... Creating` / `Created` lines first. The very first run, and the first run after `down -v`, also print `Volume ... Creating` / `Created` lines for the four volumes and the network, each twice.
- The prefix is the project name `compose.yaml` sets, so it is the same whatever your folder is called. A `-p` flag on the command changes it, and then every name above reads with yours in place of `voice-agent-workshop` (the image, the containers, the `docker rmi` below). No printed command carries a `-p` (the `Next:` lines, the `Run docker compose run --rm workshop-java make setup once` line, the "run ... again" lines), so add yours when you paste one.
- The repo is mounted into the container, so you edit files on your machine as usual. `.env`, `.workshop-lang` and `out/last-call.wav` are the files it writes in this folder, plus `java/target/` and two empty folders where the volumes mount (`typescript/node_modules/` and `tools/replay-server/node_modules/`; Git ignores them). `down -v` leaves them all alone.
- `make check` runs offline with no key. `make run` and `make live` without a key or token stop with lines saying so (`make live` inside the checker's `live did not pass:` framing). Those lines, Docker Compose's own `.env` check and `Resource is still in use` after `down -v` are in the README's [Troubleshooting](../README.md#troubleshooting).
- `down -v` removes the volumes, not the image. The next `docker compose run` recreates them empty, so `make check` stops with `The check harness isn't installed. Run docker compose run --rm workshop-java make setup once, then this command again.` and `make: *** [Makefile:...: need-sdk] Error 2`.
- Run that line as printed. It is the plain `make setup`: it installs the harness and every track whose tool is in the image, so other tracks' install lines scroll by first, including pnpm's boxed `Update available!` notice (ignore it, as above). `make setup SDK=java` installs the harness and Java only; both work here, and both fetch the SDK again.
- To get the space back as well: `docker rmi voice-agent-workshop-workshop-java` (and `voice-agent-workshop-workshop`, if you built it).

To pipe lines in, add `-T`: `printf 'hello\n' | docker compose run --rm -T workshop-java make run 00` (in PowerShell: `"hello" | docker compose run --rm -T workshop-java make run 00`). A container has no microphone or speakers: type your turns, then play `out/last-call.wav` on your machine. With Docker Engine on Linux (the usual rootful install), files and folders the container creates belong to root. From the project folder, `sudo chown -R "$(id -u):$(id -g)" .` gives them all back to you.

## Hear your agent

Every `make run` saves the agent's side of the call to `out/last-call.wav` when you hang up. So you can hear the voice, speed and greeting you picked. On a laptop, open it in any audio player (on macOS, `open out/last-call.wav`; on Linux, `xdg-open out/last-call.wav`; in WSL, `explorer.exe out`). A call that brought back no audio prints a `[no audio]` line instead and leaves the file as it was.

In Codespaces, a remote machine or a container, there is no audio device: type your turns as usual, then download the file. In Codespaces or VS Code, right-click `out/last-call.wav` in the Explorer and choose **Download**. Over SSH, copy it with `scp`. Each run writes a new `last-call.wav`, so download the one you want before the next run.

The microphone runs in one track only, and not this one: type your turns (every mission works typed) and listen to `out/last-call.wav`; [How a mission works](../README.md#how-a-mission-works) in the README has the one way to talk out loud. Wear headphones when you do: without them your agent hears itself through your speakers.

## Troubleshooting

Every one of these has happened to someone smart. The README's [Troubleshooting](../README.md#troubleshooting) has the rows every language hits; these are Java's own. Find the line you see, read what it means, apply the fix, carry on.

| You see | What's happening | Fix |
|---|---|---|
| `Java needs a JDK 17 or newer` / `Skipping Java: it needs a JDK 17 or newer` / `No javac on the PATH` | No JDK 17 or newer on your PATH (the list of folders your terminal searches for commands). `No javac on the PATH. The Java here is a runtime only.` means what you have is a JRE: a JDK includes `javac`. | Install a JDK 17 or newer (Before you start, above; on macOS the system's `java` only offers to install one), open a new terminal, and run `make setup`. In Codespaces and the dev container: `sudo apt-get update && sudo apt-get install -y openjdk-21-jdk-headless`, then `make setup`. |
| `[setup] Building the Java helpers and fetching the SDK` | The first `make setup`, or any check or run whose jars have gone (Docker's `down -v`, a cleared `~/.m2`), downloads Maven and the SDK: up to a minute, and Maven prints nothing while it does, so a still screen is normal. Each check after that takes about a second. | Nothing to do; wait for it. |
| `[setup] The Java helpers are built.` | A later `make setup`: the helpers and the SDK are in place, nothing to build. | Nothing to do. |
| `[setup] Building the Java helpers again (they changed).` | A later `make setup` or check after `java/src/main/java` or `pom.xml` changed (a `git pull`, say): a rebuild of a few seconds. | Nothing to do. |
| `The Docker image has no JDK. For Java in Docker, use the workshop-java service ...` (after `make use java`), or `The Docker image has no JDK, and Java is your language: run this same command with workshop-java in place of workshop (docker compose run --rm workshop-java make ...)` (after any command once Java is saved; after `make setup`: `Skipping Java: ...` first, then `make: *** [Makefile:...: setup] Error 2`) | You picked Java in the plain `workshop` container (`make use java`, `make setup`, or any `make ... SDK=java`). That image has no JDK. `make setup` still created `.env`, then stopped on Java's line. | Run the command the line gives: the same one on the `workshop-java` service ([Run it in Docker](#run-it-in-docker)). |
| `.env line N couldn't be read` | A quote on line N never closes or has words after it, or the line isn't `KEY=value`. On the key's line, the `is empty` line follows it: fix line N, not the key. It prints right under the first line (`Running your Java file:`, `Checking ...` or `Live check ...`), before anything else. | Write the line as `KEY=value`, no quotes. In Docker, Compose usually stops on these lines first: the two `failed to read` rows in the README's [Troubleshooting](../README.md#troubleshooting). One word after a closing quote gets through and reaches this row. |
| `Could not reach the agent: connection refused. Check DEEPGRAM_AGENT_URL.` on `make run` (`... Check WORKSHOP_URL. Is the workshop site up?` with a token), then `make: *** [Makefile:...: run] Error 2`; in `make live`, `FAIL  Could not reach production: ...` under `live did not pass:` | Nothing answered, or the address did not resolve: venue wifi, a proxy, a VPN, or a wrong `DEEPGRAM_AGENT_URL`. In place of `connection refused`, the line says `no such host`, `it timed out` or an exception's name, or none at all: `Could not reach the agent. Check DEEPGRAM_AGENT_URL.` | Leave `DEEPGRAM_AGENT_URL` empty for production; if it is, try a phone hotspot. `make check NN` needs no network. The README's [Troubleshooting](../README.md#troubleshooting) has the three rows (`custom endpoint` or `workshop proxy` in place of `production` for another address or a token). |
| `Your Java file doesn't compile: fix the first error above (java/missions/mNN_name/Start.java:N), then run make check NN again.` | The javac line above names the file and line, from the project folder. The mistake is on or right above that line: `';' expected` is on the line that lost the `;`, caret at its last token, except when the next line is `@Override` (then `illegal start of expression` there, a line or a few below). | Fix it and run the command the line names (it ends `make check NN SDK=java again.` when Java is not your saved language, and in Docker it starts `docker compose run --rm workshop-java make`). Each mission compiles on its own, so your other missions still run their checks. |
| Your editor flags `agent.put("name", obj(...))` as deprecated | `put` with an object is a deprecated Jackson call. The check compiles with warnings off, so it passes either way. | Use `agent.set("name", obj(...))` for an object (`put` is for a string or a number). |
| `MIC=1 runs in Python: make run NN SDK=py MIC=1 (add MISSION_TARGET=solution to use the reference answer)` (in Docker, `No microphone in a container. Type your turns: make run NN (Docker: docker compose run --rm workshop-java make run NN)` prints instead) | You added `MIC=1`; the microphone runs in one track only, and not this one. | Type your turns, or run the command the line gives. |

## Keep going

The missions are in the README: [Missions](../README.md#missions), then [Keep going](../README.md#keep-going). Three Java things to know on the way:

- **The smallest program, with no helpers:** `sh mission.sh example` (from `java/`; in Docker, `docker compose run --rm workshop-java sh -c 'cd java && sh mission.sh example'`). It sends Settings, waits for `SettingsApplied`, lets you type turns and saves the agent's voice to `out/last-call.wav`. With no key it stops on `DEEPGRAM_API_KEY is empty in .env (this folder). Set it: this example runs on your own key only (make run takes a workshop token too). make check NN runs offline with no key.`: "this folder" is the project folder, where `.env` lives, even from `java/`, and `NN` because the example has no check. Nothing answering at `DEEPGRAM_AGENT_URL` prints `Could not reach the agent: connection refused. Check DEEPGRAM_AGENT_URL.`, as `make run` does.
- **Staying connected.** `run` ends when the connection drops; Java has no resilient runner here, so run the program again after a drop ([Staying connected](../README.md#staying-connected) says which drops those are).
- **The helpers.** `java/src/main/java/agent/` holds every SDK call. A mission implements `agent.Mission` (`buildSettings()`, `onEvent(agent, event)`), calls `Common.run(new Start(), args)`, reads events with `event.type()`, `event.str("...")` and `event.items("...")`, and never imports `com.deepgram`. `sh mission.sh check 00-first-words` from `java/` runs one check without make's `Checking your Java file:` header or the `Next:` line (those are make's).
