// Live scripts: how a mission's live check plays the caller. See CONTRIBUTING.md.

import { loadClip } from './audio.mjs';

/**
 * Validate a live script and load its audio clips up front, so a typo fails
 * before anything connects. Each step: { after, nth?, delay_ms?, send | send_audio, silence_ms? }.
 */
export function prepareScript(script, missionDir) {
  return (script ?? []).map((step, i) => {
    const where = `missions/${missionDir}/check.mjs live.script[${i}]`;
    if (typeof step.after !== 'string' || !step.after) throw new Error(`${where}: "after" must name a server frame type`);
    if (('send' in step) === ('send_audio' in step)) throw new Error(`${where}: give exactly one of "send" or "send_audio"`);
    const nth = step.nth === undefined ? 1 : Number(step.nth);
    if (!Number.isInteger(nth) || nth < 1) throw new Error(`${where}: "nth" must be a whole number from 1`);
    const clip = step.send_audio !== undefined ? loadClip(String(step.send_audio), step.silence_ms) : null;
    return { ...step, nth, clip, fired: false };
  });
}
