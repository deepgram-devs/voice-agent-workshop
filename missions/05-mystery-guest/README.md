# 05 Mystery guest (finale)

**Goal:** your agent plays a famous figure without saying who, and someone works it out by talking to it. Your code keeps score and slips in a bigger clue when the guesser is stuck.

**You'll learn**

- A prompt that closes off every way a game breaks, line by line
- Your code as referee: counting turns and steering the agent mid-call with `UpdatePrompt`
- Why nothing in your output may name the figure

**Layer:** all four, held together by the prompt.

## Before you start

- **Runs on your own key:** yes. It uses a prompt, `UpdatePrompt` and ordinary turns, which work on any Deepgram project.
- Your start file open in your editor: `python/missions/05-mystery-guest/start.py`, `typescript/missions/05-mystery-guest/start.ts` or `java/missions/m05_mystery_guest/Start.java`; the reference answer (`solution.py`, `solution.ts` or `Solution.java`) is beside it. The rest of this page calls it your start file.
- A friend, if you want someone to guess; otherwise the file picks a figure for you (see Two ways to play).

## Two ways to play

- **Just me: surprise me.** Set `SURPRISE_ME` to true (your language's spelling is under Do this). The code picks one of twenty figures at random and never prints it, and you are the guesser. The list is in the file in ROT13 (each letter shifted 13 places), so a glance doesn't spoil it. Don't decode it.
- **Someone with me.** Set `SECRET` to a famous figure and replace `[ONE_OR_TWO_LINES]` in `CHARACTER` with their era, their work and how they talk, without the name. Then hand the keyboard to a friend.

Pick someone a stranger could land on in a few minutes: recognizable, well documented, and long dead. The agent knows nothing invented after the figure died, which is where most of the fun comes from.

## What you're building

The prompt is a template. Every line closes off one way the game breaks: a name slip, a monologue, an agent too locked down to guess, an anachronism. There's no greeting, on purpose, so nothing gets said before the first question. [Prompting voice agents](https://developers.deepgram.com/docs/prompting-voice-agents) is the general craft; this prompt is one worked example of it.

Your code is the referee. Each user `ConversationText` is one turn. Your code checks each one for the figure's name, and changes the agent's instructions mid-call with `UpdatePrompt`:

```text
user turn 1..3      nothing to do
user turn 4         no correct guess yet → UpdatePrompt: give a much bigger clue (once)
correct guess       UpdatePrompt: admit it and congratulate them; the game is over
```

`UpdatePrompt` adds to the prompt the agent already has: send only the new lines, and the Settings prompt and any earlier updates stay in force. Your code never resends the rules. [Maintaining context](https://developers.deepgram.com/docs/voice-agent-conversation-context) covers the other levers an agent has mid-call.

## Do this

Each TODO sits at a `TODO n:` comment in your start file, with the exact call to make.

1. **Pick who the agent plays.** Set `SURPRISE_ME` to true, or set `SECRET` and fill in `CHARACTER`. In Python that is `SURPRISE_ME = True` (capital T; lower-case `true` is a `NameError` there), and every `agent.` call takes `await`; in TypeScript and Java it is `true`.
2. **Spot a correct guess.** The guess test is already written (`is_correct_guess` in Python, `isCorrectGuess` in TypeScript and Java). The full name or the surname alone counts. In the event handler, when a user line names the figure, mark the game won, print `[guessed] you got it in <n> turns` (never the name), and send `UpdatePrompt` with the `REVEAL` line.
3. **Give a bigger clue once.** When the turn count reaches `CLUE_AFTER_TURNS` (4) with no correct guess, print `[clue] the agent will give a bigger clue` and send `UpdatePrompt` with the clue line built from `CLUE_TEMPLATE`. Only once, and never after a correct guess.

## Verify

**Run the checks.**

```sh
make check 05             # from the project folder. Offline: two replays, a stumped player and a lucky one. No key
make live 05              # live: the harness asks four questions without guessing
# in Docker: docker compose run --rm workshop make check 05   (workshop-java in the Java service)
# in Docker: docker compose run --rm workshop make live 05   (workshop-java in the Java service)
```

The offline check replays two conversations:

- **stumped:** five turns, no correct guess. It passes when exactly one `UpdatePrompt` goes out after the fourth user turn and before the fifth, carrying only the clue line.
- **solved:** the second turn names all twenty figures on the surprise list, so it counts as a correct guess whichever one your code picked. Nothing in the output gives the pick away. It passes when the reveal `UpdatePrompt` goes out right after that turn and no clue follows. If you chose your own `SECRET` and it isn't on the list, this replay can't name it, so it skips the guess check. Try it by hand with `make run 05`.

Both also check that your prompt names a figure, keeps the rules, and has no greeting. The live check passes when your clue goes out after the fourth question and the real agent answers it.

**Talk to it.** Needs your key or a workshop token in `.env` ([README: Your API key](../../README.md#your-api-key)).

```sh
make run 05               # from the project folder, in the language you picked with make use
# in Docker: docker compose run --rm workshop make run 05   (workshop-java in the Java service)
```

There's no greeting, so your question comes first:

> "What do you do all day?"

It answers in character. After your fourth turn you see `[clue] the agent will give a bigger clue`, and the next answer gives more away. Name the figure:

> "Are you Marie Curie?"

If you're right, `[guessed] you got it in <n> turns` prints with your turn count and the agent admits it; if not, keep asking. Ctrl-D (or Ctrl-C) hangs up.

## Stuck?

| You see | What's happening | Fix |
|---|---|---|
| `FAIL  TODO 1: pick who the agent plays: set SURPRISE_ME to true (True in Python), or set SECRET and replace [ONE_OR_TWO_LINES] in CHARACTER` | Neither way to play is set up yet. | TODO 1. |
| `FAIL  TODO 3: after 4 user turns without a correct guess, send one UpdatePrompt with a bigger clue (not before turn 4, and only once)`, or `[clue]` never prints | The turn count never reaches `CLUE_AFTER_TURNS` (4), or you count agent turns too, or the clue goes out more than once. | Count user `ConversationText` turns only, and send the clue once (TODO 3). |
| `[clue]` prints after `[guessed]` | The clue check runs after the game is won. | Never after a correct guess (TODO 3). |
| `FAIL  TODO 2: when a user line names the figure (is_correct_guess / isCorrectGuess), send UpdatePrompt with the reveal line right away` | No reveal `UpdatePrompt` on the correct guess. | TODO 2. |
| `TODO 2: your figure is not on the list of twenty, so this replay skips the guess check. Try it with make run 05` as a PASS line | You set your own `SECRET`; the `solved` replay can't name it, so it checks nothing about the guess. Expected. | Nothing: try a guess by hand with `make run 05`. |
| `FAIL  TODO 2: after a correct guess the game is over: stop counting turns, and send no clue` | A clue `UpdatePrompt` went out after the reveal. | Once the game is won, send nothing more (TODO 2 and TODO 3). |
| `FAIL  TODO 3: send only the clue line. UpdatePrompt adds to the prompt the agent already has, so the rules are still there` (or `TODO 2: send only the reveal line. ...`) | The `UpdatePrompt` carried the whole prompt again, or fewer than 20 characters. | Send only the clue line (or the reveal line): the Settings prompt stays in force. |
| The agent says who it is in its first answer | The name is in `CHARACTER` or the prompt. | Describe era, work and manner, without the name. |

<details>
<summary>Python</summary>

| You see | What's happening | Fix |
|---|---|---|
| `Your Python file doesn't run: python/missions/05-mystery-guest/start.py:22 NameError: name 'true' is not defined. Fix it and run make check 05 again.` (pytest, Python's test runner, prints it inside its `ERROR collecting` lines; 22 is the unedited file's line) | `SURPRISE_ME = true` in Python. | Capital T: `SURPRISE_ME = True`, then the command the line names (in Docker: `docker compose run --rm workshop make check 05`). |
| `FAIL  TODO 2: ...` or `FAIL  TODO 3: ...` while `[guessed]` or `[clue]` printed, with `RuntimeWarning: coroutine 'Agent.update_prompt' was never awaited` at the bottom of the output | The `UpdatePrompt` ran without `await`: your print happened, the message never went out. | `await agent.update_prompt(...)` in both places. |

</details>

<details>
<summary>TypeScript</summary>

| You see | What's happening | Fix |
|---|---|---|
| `Your file has a TypeScript type error ... a cast is not the fix, unless the mission's brief shows one.` then `missions/05-mystery-guest/start.ts(17,30): error TS2304: Cannot find name 'True'.` under `FAIL  TypeScript (tsc) found type errors in typescript/missions/05-mystery-guest/start.ts:` | `SURPRISE_ME = True` in TypeScript. The type-error line prints for every non-syntax code; vitest's `ReferenceError: True is not defined` prints above them, with `no tests`; 17 is the unedited file's line. | Lower-case: `SURPRISE_ME = true`. |

</details>

<details>
<summary>Java</summary>

| You see | What's happening | Fix |
|---|---|---|
| `java/missions/m05_mystery_guest/Start.java:31: error: cannot find symbol` with `symbol:   variable True` under it, then `Your Java file doesn't compile: fix the first error above (java/missions/m05_mystery_guest/Start.java:31), then run make check 05 again.` (31 is the unedited file's line) | `SURPRISE_ME = True` in Java. | Lower-case: `SURPRISE_ME = true`, then the command the line names (in Docker: `docker compose run --rm workshop-java make check 05`). |

</details>

Truly stuck? The reference answer is beside your start file (Before you start names it). Reading it is part of the workshop, so open it when you need it; `make check 05 MISSION_TARGET=solution` runs it.

Anything else is in the README's [Troubleshooting](../../README.md#troubleshooting), which points at your language's page.

## Check yourself

Your clue `UpdatePrompt` resends the whole prompt with the clue on the end. What has the agent got now?

<details>
<summary>Answer</summary>

The rules twice, and the clue. `UpdatePrompt` adds to the prompt the agent already has; send only the clue line, and the Settings prompt stays in force.

</details>

## Going further

Everything here runs live (`make run 05`), so it needs your key or a workshop token in `.env`; the item marked microphone needs a spoken turn too.

- **Give up.** Watch for "I give up" and reveal the answer: send `UpdatePrompt` telling the agent to say who it is.
- **A clue ladder.** Instead of one clue at turn 4, send a small clue at 4 and a big one at 7.
- **Voice to match.** Pick a voice that suits the figure: swap the voice id in `agent.speak.provider.model` and listen to who answers.
- **Hear it (microphone).** Play it out loud through your microphone (your language's block below says how; Docker and Codespaces have no microphone, so there you type your turns).

<details>
<summary>Python</summary>

Python only: `make run 05 MIC=1` (headphones on, or the agent hears itself through your speakers).

</details>

<details>
<summary>TypeScript</summary>

This one is heard in the Python track; the check is the proof. Type your turns here.

</details>

<details>
<summary>Java</summary>

This one is heard in the Python track; the check is the proof. Type your turns here.

</details>
