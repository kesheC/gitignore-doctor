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

export interface ParseOptions {
  /** Display path of the .gitignore file, POSIX, relative to the repo root. */
  source: string;
  /** Absolute path of the .gitignore file on disk. */
  sourceAbs?: string;
  /** Directory the file lives in, POSIX, relative to the repo root ("" = root). */
  baseDir?: string;
  /** First value used for the global evaluation order. */
  startOrder?: number;
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

    const regexSource = globToRegExpSource(body, anchored);
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
      regex: new RegExp(regexSource, ""),
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
