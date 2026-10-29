/**
 * Glob to regular expression translation for gitignore patterns.
 *
 * Rules are compiled once at parse time and then used for matching, so this
 * module only needs to be correct, not fast.
 */
import type { IgnoreRule, MatchResult, ChainStep } from "./types.js";

/**
 * Translate a single gitignore glob into a regular expression source string.
 *
 * @param pattern the pattern with '!' / leading '/' / trailing '/' removed
 * @param anchored true when the pattern must match from the base directory
 */
export function globToRegExpSource(pattern: string, anchored: boolean): string {
  let out = anchored ? "^" : "^(?:.*/)?";
  let i = 0;

  while (i < pattern.length) {
    const char = pattern[i];
    if (char === "*") {
      const doubleStar = pattern[i + 1] === "*";
      if (doubleStar) {
        const atStart = i === 0;
        const followedBySlash = pattern[i + 2] === "/";
        if (atStart && followedBySlash) {
          // "**<slash>" at the beginning: match zero or more leading directories.
          out += "(?:[^/]*/)*";
          i += 3;
          continue;
        }
        if (i + 2 === pattern.length) {
          // Trailing "**": everything below, at any depth.
          out += ".*";
          i += 2;
          continue;
        }
        // Middle "**<slash>": zero or more directories.
        if (followedBySlash) {
          out += "(?:[^/]*/)*";
          i += 3;
          continue;
        }
        // Any other "**" behaves like a single "*".
        out += "[^/]*";
        i += 2;
        continue;
      }
      out += "[^/]*";
      i += 1;
      continue;
    }

    if (char === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }

    if (char === "[") {
      const close = findClassEnd(pattern, i);
      if (close === -1) {
        out += "\\[";
        i += 1;
        continue;
      }
      out += classToRegExpSource(pattern.slice(i, close + 1));
      i = close + 1;
      continue;
    }

    if (char === "\\") {
      const next = pattern[i + 1];
      if (next === undefined) {
        out += "\\\\";
        i += 1;
        continue;
      }
      out += escapeRegExp(next);
      i += 2;
      continue;
    }

    out += escapeRegExp(char as string);
    i += 1;
  }

  return out + "$";
}

/** Index of the ']' that closes the bracket expression starting at `start`. */
function findClassEnd(pattern: string, start: number): number {
  let i = start + 1;
  if (pattern[i] === "!") i++;
  if (pattern[i] === "]") i++;
  while (i < pattern.length) {
    if (pattern[i] === "\\") {
      i += 2;
      continue;
    }
    if (pattern[i] === "]") return i;
    i++;
  }
  return -1;
}

/** Convert a bracket expression, including git's '!' negation, to regex source. */
function classToRegExpSource(source: string): string {
  const inner = source.slice(1, -1);
  let body = inner;
  let negated = false;
  if (body.startsWith("!")) {
    negated = true;
    body = body.slice(1);
  } else if (body.startsWith("^")) {
    negated = true;
    body = body.slice(1);
  }
  // Re-escape so that regex metacharacters inside the class keep git's meaning.
  let escaped = "";
  for (let i = 0; i < body.length; i++) {
    const char = body[i] as string;
    if (char === "\\") {
      const next = body[i + 1];
      if (next === undefined) {
        escaped += "\\\\";
      } else {
        escaped += "\\" + next;
        i++;
      }
      continue;
    }
    if (char === "]") {
      escaped += "\\]";
      continue;
    }
    if (char === "^") {
      escaped += "\\^";
      continue;
    }
    escaped += char;
  }
  return "[" + (negated ? "^" : "") + escaped + "]";
}

/** Escape a single character so it is matched literally in a regex. */
export function escapeRegExp(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? "\\" + char : char;
}

/** Normalize a path to POSIX separators and drop any leading "./". */
export function toPosix(value: string): string {
  const replaced = value.replace(/\\/g, "/");
  const trimmed = replaced.replace(/^\.\//, "");
  return trimmed.replace(/\/{2,}/g, "/");
}

/** Split a POSIX path into its non empty segments. */
export function segments(value: string): string[] {
  return value.split("/").filter((part) => part.length > 0);
}

/**
 * Test whether a rule matches one path segment-wise.
 *
 * @param rule the parsed rule
 * @param relative the candidate path relative to the rule's base directory
 * @param isDir whether the candidate is a directory
 */
export function ruleMatches(rule: IgnoreRule, relative: string, isDir: boolean): boolean {
  if (rule.dirOnly && !isDir) return false;
  if (relative === "") return false;
  return rule.regex.test(relative);
}

/**
 * Evaluate a full path against an ordered rule list.
 *
 * Walks from the shallowest ancestor to the path itself. Once an ancestor is
 * excluded the walk stops, because git cannot re-include a file whose parent
 * directory is excluded.
 */
export function matchPath(rules: IgnoreRule[], relativePath: string, isDir: boolean): MatchResult {
  const parts = segments(relativePath);
  const chain: ChainStep[] = [];
  let ignored = false;
  let winningRule: IgnoreRule | null = null;
  let matchedPath: string | null = null;
  let directRule: IgnoreRule | null = null;

  for (let depth = 1; depth <= parts.length; depth++) {
    const prefix = parts.slice(0, depth).join("/");
    const prefixIsDir = depth < parts.length ? true : isDir;
    let current: IgnoreRule | null = null;
    for (const rule of rules) {
      const relativeToBase = relativeWithin(prefix, rule.baseDir);
      if (relativeToBase === null) continue;
      if (ruleMatches(rule, relativeToBase, prefixIsDir)) current = rule;
    }

    if (depth === parts.length) directRule = current;

    if (current === null) {
      chain.push({ path: prefix, isDir: prefixIsDir, rule: null, result: "no-match" });
      continue;
    }

    const nowIgnored = !current.negated;
    chain.push({
      path: prefix,
      isDir: prefixIsDir,
      rule: current,
      result: nowIgnored ? "excluded" : "re-included",
    });

    if (nowIgnored) {
      ignored = true;
      winningRule = current;
      matchedPath = prefix;
      // An excluded intermediate directory blocks everything beneath it.
      if (depth < parts.length) break;
    } else {
      ignored = false;
      winningRule = current;
      matchedPath = prefix;
    }
  }

  return {
    ignored,
    rule: winningRule,
    matchedPath,
    viaAncestor: ignored && matchedPath !== null && matchedPath !== parts.join("/"),
    directRule,
    chain,
  };
}

/** Express `path` relative to `baseDir`, or null when it is not underneath it. */
export function relativeWithin(path: string, baseDir: string): string | null {
  if (baseDir === "") return path;
  if (path === baseDir) return "";
  const prefix = baseDir.endsWith("/") ? baseDir : baseDir + "/";
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/** Descendant check used by DEAD rule detection: does `rule` have any chance to match? */
export function ruleCouldMatch(rule: IgnoreRule, relative: string, isDir: boolean): boolean {
  return ruleMatches(rule, relative, isDir);
}

/** Sort rules the way git evaluates them: outer files first, then line order. */
export function compareRuleOrder(a: IgnoreRule, b: IgnoreRule): number {
  return a.order - b.order;
}
