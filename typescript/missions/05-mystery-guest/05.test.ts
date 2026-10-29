// Mission 05 checks. `make check 05 SDK=ts` runs the replay; `make live 05 SDK=ts` runs the live one.
import { describe, it } from 'vitest';
import { LIVE, checkLive, checkReplay, failCheck, loadTarget, replayScenarios } from '../../src/testing.js';

const mission = await loadTarget(import.meta.url);

describe('05-mystery-guest', () => {
  it.each(replayScenarios(import.meta.url))('replay: %s', async (scenario) => {
    const verdict = await checkReplay(import.meta.url, mission, scenario);
    if (!verdict.passed) failCheck(import.meta.url, verdict);
  });

  it.runIf(LIVE)('live', async () => {
    const verdict = await checkLive(import.meta.url, mission);
    if (!verdict.passed) failCheck(import.meta.url, verdict);
  });
});
