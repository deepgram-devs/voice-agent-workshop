#!/usr/bin/env node
// Name scan: fails when a tracked file names something on the FORBIDDEN_TERMS
// list. `make names` runs it; CI runs it with the list from a repository secret.
//
// The terms come only from the environment (comma separated), never from this
// repository, so the list itself is never published. With FORBIDDEN_TERMS
// empty, a local run says so and passes; under CI (the CI variable set) it
// fails, so a missing secret can't pass as a clean scan.
//
// Matching:
// a term is a name, so both sides are case folded and lose every space,
// hyphen, dash and underscore, and a folded term anywhere in the folded line
// is a hit. "secret name" catches "Secret-Name", "SecretNameEvent",
// "secretname.example", "/docs/secretnameagent" and "SECRET_NAME_URL". A term
// with an underscore is a wire identifier: it matches as written (any case)
// plus its camelCase and PascalCase forms. Each line is also read with string
// concatenation joints taken out ('Secret ' + 'Name'), and each pair of
// neighboring lines is read as one, with comment markers and quotes at the
// line edges stripped, so a term wrapped onto the next line is caught too.
//
// Joining words removes word boundaries, so a name can match across two words
// ("pine cone" inside "a spine coney"). That false positive fails
// loudly, which is better than a silent miss: product names hide in
// hostnames, URL slugs, package names and all-caps env names, glued to other
// words. Keep terms specific.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Lower case with spaces, hyphens, dashes and underscores removed. */
export const foldTerm = (s) => String(s).toLowerCase().replace(/[\s_‐-―-]+/g, '');

/** FORBIDDEN_TERMS from an env value: trimmed, empties dropped. */
export const parseTerms = (value) => String(value ?? '').split(',').map((s) => s.trim()).filter(Boolean);

const isIdentifier = (term) => term.includes('_');
const camel = (term) => term.toLowerCase().replace(/_+([a-z0-9])/g, (_, c) => c.toUpperCase());

/** A matcher for `terms`: returns the first term found in a text, or null. */
export function termMatcher(terms) {
  const names = terms.filter((t) => !isIdentifier(t)).map((term) => [term, foldTerm(term)]).filter(([, t]) => t.length > 0);
  const ids = terms.filter(isIdentifier).map((term) => {
    const c = camel(term);
    return [term, term.toLowerCase(), [c, c.charAt(0).toUpperCase() + c.slice(1)]];
  });
  return (text) => {
    if (!text) return null;
    const raw = String(text);
    if (ids.length) {
      const lower = raw.toLowerCase();
      for (const [term, t, exact] of ids) if (lower.includes(t) || exact.some((e) => raw.includes(e))) return term;
    }
    if (names.length) {
      const hay = foldTerm(raw);
      for (const [term, t] of names) if (hay.includes(t)) return term;
    }
    return null;
  };
}

// Files the scan leaves out: lockfiles (package hashes) and binary audio.
const SKIP_NAMES = new Set(['uv.lock', 'pnpm-lock.yaml', 'package-lock.json']);
const SKIP_EXT = new Set(['.wav', '.mp3', '.png', '.jpg', '.ico']);
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', '__pycache__', '.pytest_cache']);

const skipped = (path) => SKIP_NAMES.has(path.split('/').pop()) || SKIP_EXT.has(extname(path).toLowerCase());

/** Tracked files under `root`, relative to it: git when it can, a directory walk otherwise. */
export function filesUnder(root) {
  try {
    const out = execFileSync('git', ['ls-files', '-z', '--', '.'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return out.split('\0').filter(Boolean).filter((p) => !skipped(p));
  } catch {
    const found = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        if (SKIP_DIRS.has(name) || name === '.env') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else found.push(relative(root, full));
      }
    };
    walk(root);
    return found.filter((p) => !skipped(p));
  }
}

// A string concatenation joint inside a line: `' + '`, `" +\n`, `+ '`.
const JOINT = /['"`]\s*\+\s*['"`]/g;
// What a wrapped line carries at its edges: comment markers, quotes, a `+`, a comma.
const LEAD = /^\s*(?:\/\/+|#+|\/\*+|\*+|<!--|-->|>|\+)?\s*['"`]?/;
const TRAIL = /['"`]?\s*(?:\+|,|\*\/|-->)?\s*$/;

/** A line with concatenation joints and edge markers taken out. */
export const unwrap = (line) => String(line).replace(JOINT, '').replace(LEAD, '').replace(TRAIL, '');

/** Every [file, line number, term] hit in `text`'s lines, reported under `file`. */
export function scanText(file, text, match) {
  const hits = [];
  const lines = String(text).split('\n');
  const alone = lines.map((line) => match(line) ?? match(unwrap(line)));
  lines.forEach((line, i) => {
    if (alone[i]) hits.push([file, i + 1, alone[i]]);
    else if (i + 1 < lines.length && !alone[i + 1]) {
      // A term wrapped onto the next line: report the line it starts on.
      const term = match(`${unwrap(line)} ${unwrap(lines[i + 1])}`);
      if (term) hits.push([file, i + 1, term]);
    }
  });
  return hits;
}

/** Every [file, line number, term] hit in `files` under `root`. */
export function scan(root, files, match) {
  const hits = [];
  for (const file of files) {
    let text;
    try { text = readFileSync(join(root, file), 'utf8'); } catch { continue; }
    hits.push(...scanText(file, text, match));
  }
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? join(fileURLToPath(import.meta.url), '..', '..', '..'));
  const terms = parseTerms(process.env.FORBIDDEN_TERMS);
  if (!terms.length) {
    if (process.env.CI) {
      console.log('names: FORBIDDEN_TERMS is empty in CI. Set the FORBIDDEN_TERMS repository secret; the workflow skips this job for pull requests from forks.');
      process.exit(1);
    }
    console.log('names: FORBIDDEN_TERMS is unset, so the name scan is skipped');
    process.exit(0);
  }
  const files = filesUnder(root);
  const hits = scan(root, files, termMatcher(terms));
  // The file and line only: the term itself stays out of the log, like the list.
  for (const [file, line] of hits) console.log(`names: ${file}:${line} names a term on the FORBIDDEN_TERMS list`);
  console.log(`names: ${files.length} files, ${terms.length} term(s), ${hits.length} hit(s)`);
  process.exit(hits.length ? 1 : 0);
}
