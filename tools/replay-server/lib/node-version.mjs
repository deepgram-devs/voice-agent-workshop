// The Node.js the harness runs on: package.json's engines, ^20.19.0 || >=22.12.0.
// npm ci only warns outside that range, and the checks then fail without saying
// why, so the harness stops with one line first. The Makefile's setup-harness
// checks the same range before npm ci (NODE_OK) and prints the same line
// (MSG_NODE_OLD); tools/make/make.test.mjs keeps the two lines equal.

/** True for a Node.js version (`22.12.0`, no `v`) the harness supports. */
export function nodeSupported(version = process.versions.node) {
  const [a, b] = version.split('.').map(Number);
  return a > 22 || (a === 22 && b >= 12) || (a === 20 && b >= 19);
}

/** The line for a Node.js that is too old; `version` as `node -v` prints it. */
export function nodeTooOld(version = process.version) {
  return `The checks need Node.js 20.19+ or 22.12+ (you have ${version}). Install Node.js 22 from https://nodejs.org, then run make setup again.`;
}
