/**
 * Parsing of .gitignore files into structured rules.
 *
 * The semantics implemented here follow gitignore(5) exactly:
 *   - blank lines and '#' comments are skipped
 *   - trailing spaces are stripped unless escaped with a backslash
 *   - '!' negates, '\\!' and '\\#' are literal escapes
 *   - a trailing '/' makes the pattern directory-only
 *   - a '/' at the start or in the middle anchors the pattern to the
 *     directory that owns the .gitignore file; otherwise it matches any level
 */
import type { IgnoreRule } from "./types.js";
import { globToRegExpSource } from "./matcher.js";

/**
 * Patterns longer than this are not compiled.
 *
 * V8 checks the size of a regular expression lazily, on first use, and refuses
 * sources past 2^15 characters with "Regular expression too large". A rule
 * that big cannot match anything anyone wrote on purpose, and letting it reach
 * `RegExp.test` took the entire command down, so it is recorded as invalid
 * instead. 4096 is far above any real .gitignore line and far below the limit.
 */
const MAX_PATTERN_LENGTH = 4096;

/** Build the matcher for a rule, downgrading an unusable pattern to "matches nothing". */
function compileMatcher(
  source: string,
  ignoreCase: boolean,
): { regex: RegExp; patternError: string | null } {
  try {
    const regex = new RegExp(source, ignoreCase ? "i" : "");
    // V8 compiles lazily: a source it will refuse only throws when first used.
    // One throwaway test here turns that deferred failure into an answer we can
    // record, instead of a crash somewhere far away during the tree walk.
    regex.test("");
    return { regex, patternError: null };
  } catch (error) {
    return {
      regex: /(?!)/,
      patternError: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Shorten a pattern for a message; a 40 000 character line belongs in no report. */
export function abbreviatePattern(pattern: string, limit = 60): string {
  if (pattern.length <= limit) return pattern;
  return pattern.slice(0, limit) + "... (" + pattern.length + " characters)";
}

export interface ParseOptions {
  /** Display path of the .gitignore file, POSIX, relative to the repo root. */
  source: string;
  /** Absolute path of the .gitignore file on disk. */
  sourceAbs?: string;
  /** Directory the file lives in, POSIX, relative to the repo root ("" = root). */
  baseDir?: string;
  /** First value used for the global evaluation order. */
  startOrder?: number;
  /**
   * Compile the matchers case-insensitively.
   *
   * Git decides this from `core.ignorecase`, which `git init` sets on
   * case-insensitive filesystems (Windows, default macOS). It is off unless
   * explicitly requested so the pure parser stays predictable.
   */
  ignoreCase?: boolean;
}

/** Remove unescaped trailing spaces, as git does. */
export function stripTrailingSpaces(line: string): string {
  let end = line.length;
  while (end > 0 && line[end - 1] === " ") {
    let backslashes = 0;
    let i = end - 2;
    while (i >= 0 && line[i] === "\\") {
      backslashes++;
      i--;
    }
    if (backslashes % 2 === 1) break;
    end--;
  }
  return line.slice(0, end);
}

/** True when the final character of `s` is escaped by an odd number of backslashes. */
function isEscaped(s: string): boolean {
  let backslashes = 0;
  let i = s.length - 1;
  while (i >= 0 && s[i] === "\\") {
    backslashes++;
    i--;
  }
  return backslashes % 2 === 1;
}

/** Parse the text of one .gitignore file into ordered rules. */
export function parseIgnoreFile(content: string, options: ParseOptions): IgnoreRule[] {
  const baseDir = options.baseDir ?? "";
  const sourceAbs = options.sourceAbs ?? options.source;
  const rules: IgnoreRule[] = [];
  let order = options.startOrder ?? 0;

  const lines = content.split("\n");
  for (let index = 0; index < lines.length; index++) {
    const rawLine = lines[index] ?? "";
    let line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") continue;
    // A comment is a line whose very first character is '#'. Leading spaces
    // are significant, so "  #foo" is a pattern, not a comment.
    if (line.startsWith("#")) continue;
    line = stripTrailingSpaces(line);
    if (line === "") continue;

    let negated = false;
    let body = line;
    if (body.startsWith("\\!") || body.startsWith("\\#")) {
      body = body.slice(1);
    } else if (body.startsWith("!")) {
      negated = true;
      body = body.slice(1);
    }
    if (body === "") continue;

    let dirOnly = false;
    if (body.endsWith("/") && !isEscaped(body.slice(0, -1))) {
      dirOnly = true;
      body = body.slice(0, -1);
    }
    if (body === "") continue;

    let anchored = false;
    if (body.startsWith("/")) {
      anchored = true;
      body = body.slice(1);
    } else if (body.includes("/")) {
      anchored = true;
    }
    if (body === "") continue;

    if (body.length > MAX_PATTERN_LENGTH) {
      rules.push({
        raw: line,
        pattern: body,
        negated,
        dirOnly,
        anchored,
        source: options.source,
        sourceAbs,
        line: index + 1,
        baseDir,
        regex: /(?!)/,
        patternError:
          "the pattern is " + body.length + " characters long; the limit is " + MAX_PATTERN_LENGTH,
        order: order++,
      });
      continue;
    }

    const compiled = compileMatcher(globToRegExpSource(body, anchored), options.ignoreCase === true);
    rules.push({
      raw: line,
      pattern: body,
      negated,
      dirOnly,
      anchored,
      source: options.source,
      sourceAbs,
      line: index + 1,
      baseDir,
      regex: compiled.regex,
      patternError: compiled.patternError,
      order: order++,
    });
  }

  return rules;
}

/** Human readable description of a rule's shape. */
export function describeRule(rule: IgnoreRule): string {
  const bits: string[] = [];
  if (rule.negated) bits.push("negation");
  if (rule.dirOnly) bits.push("directory-only");
  if (rule.anchored) bits.push("anchored");
  if (bits.length === 0) bits.push("matches at any level");
  return bits.join(", ");
}