// Mission 05 checks, shared by every language. Contract: CONTRIBUTING.md.
//
// Nothing here prints the figure: in surprise mode the player is the guesser.

const CLUE_AFTER_TURNS = 4;
const RULE = 'Never say your own name';

// The surprise list in plain text, to tell whether the "solved" replay can name
// the figure. Its spray guess names all twenty.
const SURPRISE_LIST = [
  'Cleopatra', 'Julius Caesar', 'Leonardo da Vinci', 'Joan of Arc', 'William Shakespeare',
  'Galileo Galilei', 'Isaac Newton', 'Mozart', 'Napoleon', 'Jane Austen',
  'Ada Lovelace', 'Charles Darwin', 'Abraham Lincoln', 'Florence Nightingale', 'Vincent van Gogh',
  'Nikola Tesla', 'Marie Curie', 'Harry Houdini', 'Amelia Earhart', 'Frida Kahlo',
];

const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** The figure from the prompt's "You are:" line, or ''. */
function figureOf(settings) {
  const prompt = settings?.agent?.think?.prompt;
  const m = typeof prompt === 'string' ? prompt.match(/^You are:[ \t]*(.*)$/m) : null;
  return m ? m[1].trim() : '';
}

/** TODO 1 and the game's rules. */
function settingsChecks(s, t) {
  const settings = s.settings;
  if (!t.ok(settings, 'Your program sends a Settings message after Welcome')) return null;
  const prompt = t.get(settings, 'agent.think.prompt');
  t.ok(
    figureOf(settings) !== '' && typeof prompt === 'string' && !prompt.includes('[ONE_OR_TWO_LINES]'),
    'TODO 1: pick who the agent plays: set SURPRISE_ME to true (True in Python), or set SECRET and replace [ONE_OR_TWO_LINES] in CHARACTER',
  );
  t.ok(typeof prompt === 'string' && prompt.includes(RULE), `Keep the rules in the prompt, starting with "${RULE}"`);
  t.ok(!t.get(settings, 'agent.greeting'), 'Leave agent.greeting out: a greeting can give the game away before the first question');
  return settings;
}

/** Positions in s.events of every user ConversationText, in order. */
function userTurns(s) {
  const out = [];
  s.events.forEach((e, i) => {
    if (e.dir === 'server' && e.frame?.type === 'ConversationText' && e.frame.role === 'user') out.push(i);
  });
  return out;
}

/** Positions in s.events of every UpdatePrompt your program sent. */
function updates(s) {
  const out = [];
  s.events.forEach((e, i) => {
    if (e.dir === 'client' && e.frame?.type === 'UpdatePrompt') out.push(i);
  });
  return out;
}

const between = (i, lo, hi) => i > lo && (hi < 0 || i < hi);

/** An UpdatePrompt carries only its new line: UpdatePrompt adds to the prompt the agent already has. */
function lineOnly(text, t, todo, what) {
  t.ok(
    typeof text === 'string' && text.trim().length >= 20 && !text.includes(RULE),
    `${todo}: send only the ${what} line. UpdatePrompt adds to the prompt the agent already has, so the rules are still there`,
  );
}

/** TODO 3: exactly one clue, after turn CLUE_AFTER_TURNS and before the next. */
function clueChecks(s, t) {
  const turns = userTurns(s);
  const sent = updates(s);
  const after = turns[CLUE_AFTER_TURNS - 1] ?? -1;
  const next = turns[CLUE_AFTER_TURNS] ?? -1;
  const ok = after >= 0 && sent.length === 1 && between(sent[0], after, next);
  t.ok(
    ok,
    `TODO 3: after ${CLUE_AFTER_TURNS} user turns without a correct guess, send one UpdatePrompt with a bigger clue (not before turn ${CLUE_AFTER_TURNS}, and only once)`,
  );
  if (sent.length === 1) lineOnly(s.events[sent[0]].frame.prompt, t, 'TODO 3', 'clue');
  return ok;
}

export default {
  replay: [
    {
      name: 'stumped',
      fixture: 'stumped.jsonl',
      assert(s, t) {
        if (!settingsChecks(s, t)) return;
        clueChecks(s, t);
      },
    },
    {
      name: 'solved',
      fixture: 'solved.jsonl',
      assert(s, t) {
        const settings = settingsChecks(s, t);
        if (!settings) return;
        const figure = norm(figureOf(settings));
        if (figure && !SURPRISE_LIST.some((f) => norm(f) === figure)) {
          // Your own figure isn't on the list, so this replay can't name it. The stumped replay still checks TODO 3.
          t.ok(true, 'TODO 2: your figure is not on the list of twenty, so this replay skips the guess check. Try it with make run 05');
          return;
        }
        const turns = userTurns(s);
        const sent = updates(s);
        t.ok(
          sent.length >= 1 && between(sent[0], turns[1] ?? -1, turns[2] ?? -1),
          'TODO 2: when a user line names the figure (is_correct_guess / isCorrectGuess), send UpdatePrompt with the reveal line right away',
        );
        if (sent.length >= 1) lineOnly(s.events[sent[0]].frame.prompt, t, 'TODO 2', 'reveal');
        t.ok(sent.length <= 1, 'TODO 2: after a correct guess the game is over: stop counting turns, and send no clue');
      },
    },
  ],
  live: {
    timeoutMs: 60000,
    // The harness plays a stumped player: four turns, no correct guess. There is
    // no greeting, so the nth AgentAudioDone is the end of the agent's nth answer,
    // and each question waits for the previous answer to finish playing.
    script: [
      { after: 'SettingsApplied', delay_ms: 1000, send: { type: 'InjectUserMessage', content: 'Hello! What do you do all day?' } },
      { after: 'AgentAudioDone', nth: 1, delay_ms: 500, send: { type: 'InjectUserMessage', content: 'Where do you live?' } },
      { after: 'AgentAudioDone', nth: 2, delay_ms: 500, send: { type: 'InjectUserMessage', content: 'Are you a painter?' } },
      { after: 'AgentAudioDone', nth: 3, delay_ms: 500, send: { type: 'InjectUserMessage', content: 'Give me a hint, please.' } },
    ],
    until: (s) => {
      const sent = updates(s);
      return sent.length > 0 && s.events.some((e, i) => i > sent[0] && e.dir === 'server' && e.frame?.type === 'ConversationText' && e.frame.role === 'assistant');
    },
    grace_ms: 1000,
    assert(s, t) {
      if (!settingsChecks(s, t)) return;
      for (const e of s.receivedOfType('Error')) t.fail(`The agent sent an error: ${e.description ?? e.message ?? ''} (${e.code ?? 'no code'})`);
      t.ok(s.receivedOfType('SettingsApplied').length > 0, 'The agent accepted your Settings (SettingsApplied)');
      t.ok(userTurns(s).length >= CLUE_AFTER_TURNS, `The agent heard ${CLUE_AFTER_TURNS} user turns (user ConversationText)`);
      if (clueChecks(s, t)) {
        const sent = updates(s)[0];
        t.ok(
          s.events.some((e, i) => i > sent && e.dir === 'server' && e.frame?.type === 'ConversationText' && e.frame.role === 'assistant'),
          'The agent answered after your clue (an assistant ConversationText after the UpdatePrompt)',
        );
      }
    },
  },
};
