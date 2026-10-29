// The assertion API mission checks use. Every call records a result instead of
// throwing, so one run reports every problem at once. Messages are read by
// attendees: say what to change, not what the harness saw internally.

import { get } from './session.mjs';

export function createAsserts() {
  const results = [];
  const record = (pass, message, detail) => {
    results.push({ pass: Boolean(pass), message, ...(pass || detail === undefined ? {} : { detail }) });
    return Boolean(pass);
  };

  const t = {
    results,
    /** Passes when `cond` is truthy. */
    ok(cond, message) {
      return record(cond, message);
    },
    /** Passes when actual === expected (deep for plain objects and arrays). */
    equal(actual, expected, message) {
      return record(JSON.stringify(actual) === JSON.stringify(expected), message, { actual, expected });
    },
    /** Passes when `value` is a string matching `pattern`. */
    match(value, pattern, message) {
      return record(typeof value === 'string' && pattern.test(value), message, { actual: value, pattern: String(pattern) });
    },
    /** Passes when the dotted `path` exists in `obj` and is not null/empty. Returns the value. */
    has(obj, path, message) {
      const v = get(obj, path);
      const present = v !== undefined && v !== null && !(typeof v === 'string' && v.trim() === '');
      record(present, message ?? `${path} is set`, { path });
      return v;
    },
    /** Passes when index a comes before index b and both exist (see session.indexOf). */
    before(a, b, message) {
      return record(a >= 0 && b >= 0 && a < b, message, { first: a, second: b });
    },
    /** Read a dotted path without asserting. */
    get,
    /** Record a failure unconditionally. */
    fail(message, detail) {
      return record(false, message, detail);
    },
  };
  return t;
}
