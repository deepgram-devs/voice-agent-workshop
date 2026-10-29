// Mission 04 checks. `make check 04 SDK=ts` runs the replay; `make live 04 SDK=ts` runs the live one.
import { describe, it } from 'vitest';
import { LIVE, checkLive, checkReplay, failCheck, loadTarget, replayScenarios } from '../../src/testing.js';

const mission = await loadTarget(import.meta.url);

describe('04-polyglot', () => {
  it.each(replayScenarios(import.meta.url))('replay: %s', async (scenario) => {
    const verdict = await checkReplay(import.meta.url, mission, scenario);
    if (!verdict.passed) failCheck(import.meta.url, verdict);
  });

  it.runIf(LIVE)('live', async () => {
    const verdict = await checkLive(import.meta.url, mission);
    if (!verdict.passed) failCheck(import.meta.url, verdict);
  });
});
