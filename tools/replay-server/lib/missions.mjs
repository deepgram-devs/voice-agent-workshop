// Find a mission folder and load its check.mjs.

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
export const MISSIONS_DIR = join(ROOT, 'missions');
export const FIXTURES_DIR = join(ROOT, 'fixtures');

/** "00", "0", "00-first-words" or "first-words" -> "00-first-words". */
export function resolveMission(name) {
  const dirs = readdirSync(MISSIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  const n = String(name).trim();
  const padded = /^\d+$/.test(n) ? n.padStart(2, '0') : n;
  const hit = dirs.find((d) => d === padded) ?? dirs.find((d) => d.startsWith(`${padded}-`)) ?? dirs.find((d) => d.endsWith(`-${n}`));
  if (!hit) throw new Error(`No mission "${name}". Try one of: ${dirs.join(', ')}`);
  return hit;
}

export async function loadCheck(missionDir) {
  const file = join(MISSIONS_DIR, missionDir, 'check.mjs');
  if (!existsSync(file)) throw new Error(`missions/${missionDir} has no check.mjs`);
  const mod = await import(pathToFileURL(file).href);
  const check = mod.default ?? {};
  const replay = Array.isArray(check.replay) ? check.replay : [];
  for (const s of replay) {
    if (!s.name || !s.fixture || typeof s.assert !== 'function') throw new Error(`missions/${missionDir}/check.mjs: each replay scenario needs name, fixture and assert()`);
  }
  return { replay, live: check.live ?? null };
}

export function fixturePath(missionDir, fixture) {
  return join(FIXTURES_DIR, missionDir, fixture);
}
