/**
 * Repository level composition: discover ignore files, build the ordered rule
 * list, and turn a path into a full explanation.
 */
import { readFile, stat } from "node:fs/promises";
import { access } from "node:fs/promises";
import * as path from "node:path";
import { homedir } from "node:os";

import { parseIgnoreFile } from "./rules.js";
import { matchPath, relativeWithin, segments, toPosix } from "./matcher.js";
import type { ExplainResult, IgnoreFile, IgnoreRule, MatchResult } from "./types.js";
import { isTracked } from "./git.js";

/** Walk up from `startDir` looking for a directory that contains `.git`. */
export async function findRepoRoot(startDir: string): Promise<string> {
  let current = path.resolve(startDir);
  for (;;) {
    try {
      await stat(path.join(current, ".git"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return path.resolve(startDir);
      current = parent;
    }
  }
}

async function readIfPresent(absolute: string): Promise<string | null> {
  try {
    return await readFile(absolute, "utf8");
  } catch {
    return null;
  }
}

async function exists(absolute: string): Promise<boolean> {
  try {
    await access(absolute);
    return true;
  } catch {
    return false;
  }
}

/** Read one ignore file into a structured record, or null when missing. */
async function loadIgnoreFile(
  root: string,
  relative: string,
  startOrder: number,
): Promise<IgnoreFile | null> {
  const sourceAbs = path.join(root, relative.split("/").join(path.sep));
  const content = await readIfPresent(sourceAbs);
  if (content === null) return null;
  const baseDir = relative === ".gitignore" ? "" : toPosix(path.dirname(relative));
  const rules = parseIgnoreFile(content, {
    source: relative,
    sourceAbs,
    baseDir: baseDir === "." ? "" : baseDir,
    startOrder,
  });
  return { source: relative, sourceAbs, baseDir: baseDir === "." ? "" : baseDir, rules };
}

export interface CollectOptions {
  /** Also read .git/info/exclude (default true). */
  gitInfoExclude?: boolean;
  /** Also read core.excludesFile (default false). */
  global?: boolean;
  /** Directory whose .gitignore chain should be followed; undefined = the whole tree. */
  forPath?: string;
}

/**
 * Collect the ignore files that apply to a repository, in evaluation order.
 *
 * When `forPath` is given only the files on the way from the root down to that
 * path are read; otherwise every .gitignore file in the tree is discovered.
 */
export async function collectIgnoreFiles(
  root: string,
  options: CollectOptions = {},
): Promise<IgnoreFile[]> {
  const files: IgnoreFile[] = [];
  let order = 0;

  const rootFile = await loadIgnoreFile(root, ".gitignore", order);
  if (rootFile) {
    files.push(rootFile);
    order += rootFile.rules.length;
  }

  if (options.forPath !== undefined) {
    const parts = segments(options.forPath).slice(0, -1);
    for (let depth = 1; depth <= parts.length; depth++) {
      const dir = parts.slice(0, depth).join("/");
      const relative = dir + "/.gitignore";
      const file = await loadIgnoreFile(root, relative, order);
      if (file) {
        files.push(file);
        order += file.rules.length;
      }
    }
  } else {
    const discovered = await discoverIgnoreFiles(root);
    for (const relative of discovered) {
      if (relative === ".gitignore") continue;
      const file = await loadIgnoreFile(root, relative, order);
      if (file) {
        files.push(file);
        order += file.rules.length;
      }
    }
  }

  if (options.gitInfoExclude !== false) {
    const info = await loadIgnoreFile(root, ".git/info/exclude", order);
    if (info) {
      files.push(info);
      order += info.rules.length;
    }
  }

  if (options.global) {
    const resolved = await resolveGlobalIgnore(root);
    if (resolved) {
      const file = await loadIgnoreFile("", resolved.source, order);
      if (file) files.push(file);
    }
  }

  return files;
}

async function resolveGlobalIgnore(root: string): Promise<{ source: string } | null> {
  const home = homedir();
  const candidates = [".config/git/ignore", ".gitignore_global"];
  for (const candidate of candidates) {
    const absolute = path.join(home, candidate.split("/").join(path.sep));
    if (await exists(absolute)) return { source: toPosix(absolute) };
  }
  return null;
}

/** Depth-first discovery of every .gitignore file below `root`, excluding .git. */
export async function discoverIgnoreFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (relativeDir: string): Promise<void> => {
    const absoluteDir = relativeDir === "" ? root : path.join(root, relativeDir.split("/").join(path.sep));
    let entries: Awaited<ReturnType<typeof readdirSafe>>;
    entries = await readdirSafe(absoluteDir);
    for (const entry of entries) {
      if (entry === ".git" || entry === "node_modules") continue;
      const relative = relativeDir === "" ? entry : relativeDir + "/" + entry;
      const absolute = path.join(absoluteDir, entry.split("/").join(path.sep));
      const info = await statSafe(absolute);
      if (info === null) continue;
      if (info.isDirectory()) {
        await walk(relative);
      } else if (entry === ".gitignore") {
        found.push(relative);
      }
    }
  };
  await walk("");
  return found.sort();
}

async function readdirSafe(absolute: string): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    return await readdir(absolute);
  } catch {
    return [];
  }
}

async function statSafe(absolute: string): Promise<Awaited<ReturnType<typeof stat>> | null> {
  try {
    return await stat(absolute);
  } catch {
    return null;
  }
}

/** Flatten ignore files into the ordered rule list git would apply. */
export function flattenRules(files: IgnoreFile[]): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const file of files) rules.push(...file.rules);
  return rules.sort((a, b) => a.order - b.order);
}

/** Normalize a user supplied path into a POSIX path relative to `root`. */
export function normalizeTarget(root: string, target: string, cwd: string): string {
  const absolute = path.isAbsolute(target) ? target : path.resolve(cwd, target);
  const relative = path.relative(root, absolute);
  return toPosix(relative === "" ? "." : relative);
}

/**
 * Explain why a path is (or is not) ignored.
 *
 * The walk always visits every ancestor first, because a rule that matches a
 * parent directory hides everything inside it regardless of later rules.
 */
export async function explainPath(
  target: string,
  options: { cwd?: string; global?: boolean } = {},
): Promise<ExplainResult> {
  const cwd = options.cwd ?? process.cwd();
  const root = await findRepoRoot(path.isAbsolute(target) ? path.dirname(target) : cwd);
  const relative = normalizeTarget(root, target, cwd);
  const absolute = path.isAbsolute(target) ? target : path.resolve(cwd, target);

  const info = await statSafe(absolute);
  const isDir = info !== null && info.isDirectory();
  const existsOnDisk = info !== null;

  const files = await collectIgnoreFiles(root, { forPath: relative, global: options.global });
  const rules = flattenRules(files);
  const result: MatchResult = matchPath(rules, relative, isDir);
  const tracked = await isTracked(root, relative);

  const whitelistedBy = result.ignored
    ? findWhitelist(rules, relative, isDir, result)
    : null;

  const reason = buildReason(result, relative, isDir, existsOnDisk, tracked);
  const note = buildNote(result, relative, isDir, tracked);

  return {
    ...result,
    path: relative,
    absolute,
    isDir,
    exists: existsOnDisk,
    tracked,
    reason,
    note,
    whitelistedBy,
  };
}

/**
 * Find a rule that re-includes the path but never got the chance to run,
 * which is the classic "my '!' rule does not work" trap.
 */
function findWhitelist(
  rules: IgnoreRule[],
  relative: string,
  isDir: boolean,
  result: MatchResult,
): IgnoreRule | null {
  const winner = result.rule;
  if (!winner) return null;
  for (const rule of rules) {
    if (!rule.negated) continue;
    if (rule.order <= winner.order) continue;
    const within = relativeWithin(relative, rule.baseDir);
    if (within === null || within === "") continue;
    if (rule.dirOnly && !isDir) continue;
    if (rule.regex.test(within)) return rule;
  }
  return null;
}

function buildReason(
  result: MatchResult,
  relative: string,
  isDir: boolean,
  exists: boolean,
  tracked: boolean | null,
): string {
  if (!result.ignored) {
    if (result.rule && result.rule.negated) {
      return "re-included by " + formatRule(result.rule);
    }
    if (result.directRule && result.directRule.negated) {
      return "re-included by " + formatRule(result.directRule);
    }
    return exists
      ? "no ignore rule matches this path"
      : "no ignore rule matches this path (and it does not exist on disk)";
  }

  const rule = result.rule;
  if (!rule) return "ignored";
  const where = result.viaAncestor
    ? "ancestor directory '" + (result.matchedPath ?? "") + "'"
    : isDir
      ? "this directory"
      : "this file";
  const parts = [
    "excluded by " + formatRule(rule),
    "(" + (rule.dirOnly ? "directory-only match on " : "match on ") + where + ")",
  ];
  if (tracked === true) {
    parts.push("- but git already tracks this path, so the rule is not protecting you");
  }
  return parts.join(" ");
}

function buildNote(
  result: MatchResult,
  relative: string,
  isDir: boolean,
  tracked: boolean | null,
): string | null {
  if (result.ignored && tracked === true) {
    return (
      "git keeps tracking this path until you run `git rm -r --cached " +
      relative +
      "`; ignoring a tracked file has no effect."
    );
  }
  if (result.ignored && result.viaAncestor) {
    return (
      "the parent directory '" +
      (result.matchedPath ?? "") +
      "' is excluded, so git never looks inside it; re-including a child needs the parent re-included first."
    );
  }
  if (!result.ignored && !isDir) {
    return null;
  }
  return null;
}

/** Render a rule as `source:line "raw"`. */
export function formatRule(rule: IgnoreRule): string {
  return rule.source + ":" + rule.line + ' "' + rule.raw + '"';
}
