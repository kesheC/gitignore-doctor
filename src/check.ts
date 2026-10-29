/**
 * Repository audit: LEAK / MISSING / DEAD / CONFLICT.
 */
import { readdir, stat } from "node:fs/promises";
import * as path from "node:path";

import { collectIgnoreFiles, flattenRules, findRepoRoot } from "./resolve.js";
import { matchPath, relativeWithin } from "./matcher.js";
import { listTrackedFiles, isGitAvailable } from "./git.js";
import type { CheckOptions, CheckReport, IgnoreRule, Issue, IssueKind } from "./types.js";

/** Filenames / globs that should essentially never be committed. */
const NEVER_COMMIT: Array<{ test: (name: string, relative: string) => boolean; label: string }> = [
  { test: (name) => name === ".env", label: "environment file" },
  { test: (name) => /^\.env\..+$/.test(name) && !/\.(example|sample|template)$/.test(name), label: "environment file" },
  { test: (name) => /\.(pem|key|p12|pfx|keystore)$/i.test(name), label: "private key or certificate" },
  { test: (name) => /\.log$/i.test(name), label: "log file" },
  { test: (name) => name === ".DS_Store" || name === "Thumbs.db", label: "OS metadata file" },
  { test: (name) => /\.(sqlite|sqlite3|db)$/i.test(name), label: "local database" },
  { test: (_name, relative) => relative.split("/").includes("node_modules"), label: "installed dependencies" },
];

/** Extra severity for secrets, so LEAK output is ordered by real danger. */
function leakSeverity(relative: string): number {
  const name = relative.split("/").pop() ?? relative;
  if (name === ".env" || /^\.env\./.test(name)) return 100;
  if (/\.(pem|key|p12|pfx|keystore)$/i.test(name)) return 95;
  if (/id_rsa|id_ed25519|\.htpasswd|credentials/i.test(name)) return 90;
  if (/\.log$/i.test(name)) return 60;
  if (/\.(sqlite|sqlite3|db)$/i.test(name)) return 55;
  return 30;
}

function missSeverity(relative: string): number {
  const name = relative.split("/").pop() ?? relative;
  if (name === ".env" || /^\.env\./.test(name)) return 100;
  if (/\.(pem|key|p12|pfx)$/i.test(name)) return 90;
  if (relative.split("/").includes("node_modules")) return 80;
  if (/\.log$/i.test(name)) return 50;
  if (name === ".DS_Store" || name === "Thumbs.db") return 20;
  return 40;
}

interface WalkEntry {
  relative: string;
  isDir: boolean;
}

const SKIP_DIRS = new Set([".git", "node_modules"]);

/** Collect working tree entries, honouring a hard cap so huge repos stay usable. */
async function walkTree(root: string, maxEntries: number): Promise<{ entries: WalkEntry[]; scanned: number }> {
  const entries: WalkEntry[] = [];
  let scanned = 0;
  const queue: string[] = [""];

  while (queue.length > 0) {
    const relativeDir = queue.shift() as string;
    const absoluteDir = relativeDir === "" ? root : path.join(root, relativeDir.split("/").join(path.sep));
    let names: string[];
    try {
      names = await readdir(absoluteDir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (scanned >= maxEntries) return { entries, scanned };
      const relative = relativeDir === "" ? name : relativeDir + "/" + name;
      const absolute = path.join(absoluteDir, name);
      let info;
      try {
        info = await stat(absolute);
      } catch {
        continue;
      }
      scanned++;
      entries.push({ relative, isDir: info.isDirectory() });
      if (info.isDirectory() && !SKIP_DIRS.has(name)) queue.push(relative);
    }
  }

  return { entries, scanned };
}

/**
 * Audit a repository.
 *
 * LEAK needs git; when git is missing the other three checks still run and the
 * report records `gitAvailable: false`.
 */
export async function checkRepo(
  cwd: string,
  options: CheckOptions = {},
): Promise<CheckReport> {
  const root = await findRepoRoot(cwd);
  const maxEntries = options.maxEntries ?? 200_000;

  const files = await collectIgnoreFiles(root, { gitInfoExclude: false });
  const rules = flattenRules(files);
  const { entries, scanned } = await walkTree(root, maxEntries);

  const issues: Issue[] = [];
  const gitAvailable = await isGitAvailable(root);
  const tracked = gitAvailable ? await listTrackedFiles(root) : null;

  // --- LEAK: tracked files that the rules would ignore -----------------------
  if (tracked) {
    for (const relative of tracked) {
      const verdict = matchPath(rules, relative, false);
      if (!verdict.ignored) continue;
      issues.push({
        kind: "LEAK",
        severity: leakSeverity(relative),
        path: relative,
        rule: verdict.rule,
        message:
          relative +
          " is tracked by git but matches " +
          (verdict.rule ? verdict.rule.source + ":" + verdict.rule.line + ' "' + verdict.rule.raw + '"' : "an ignore rule"),
        advice:
          "run `git rm --cached \"" + relative + "\"` to stop tracking it (the file stays on disk)",
      });
    }
  }

  // --- MISSING: untracked, not ignored, but obviously should be -------------
  const trackedSet = new Set(tracked ?? []);
  for (const entry of entries) {
    if (trackedSet.has(entry.relative)) continue;
    const verdict = matchPath(rules, entry.relative, entry.isDir);
    if (verdict.ignored) continue;
    const name = entry.relative.split("/").pop() ?? entry.relative;
    const matched = NEVER_COMMIT.find((candidate) => candidate.test(name, entry.relative));
    if (!matched) continue;
    issues.push({
      kind: "MISSING",
      severity: missSeverity(entry.relative),
      path: entry.relative,
      rule: null,
      message: entry.relative + " looks like " + withArticle(matched.label) + " but no ignore rule covers it",
      advice: "add a rule such as `" + suggestionFor(entry.relative) + "` to .gitignore",
    });
  }

  // --- DEAD / CONFLICT ------------------------------------------------------
  const perRuleHits = new Map<IgnoreRule, number>();
  for (const rule of rules) perRuleHits.set(rule, 0);
  for (const entry of entries) {
    for (const rule of rules) {
      const within = relativeWithin(entry.relative, rule.baseDir);
      if (within === null || within === "") continue;
      if (rule.dirOnly && !entry.isDir) continue;
      if (rule.regex.test(within)) {
        perRuleHits.set(rule, (perRuleHits.get(rule) ?? 0) + 1);
      }
    }
  }

  for (const rule of rules) {
    const hits = perRuleHits.get(rule) ?? 0;
    if (hits > 0) continue;
    issues.push({
      kind: "DEAD",
      severity: 10,
      path: null,
      rule,
      message:
        rule.source + ":" + rule.line + ' "' + rule.raw + '" matches nothing in this repository',
      advice: "delete the rule, or fix it if the path moved",
    });
  }

  for (let i = 0; i < rules.length; i++) {
    const earlier = rules[i];
    if (!earlier || earlier.negated) continue;
    for (let j = i + 1; j < rules.length; j++) {
      const later = rules[j];
      if (!later || later.negated) continue;
      if (later.baseDir !== earlier.baseDir) continue;
      if (!isStrictlyBroader(later, earlier)) continue;
      issues.push({
        kind: "CONFLICT",
        severity: 15,
        path: null,
        rule: earlier,
        message:
          earlier.source + ":" + earlier.line + ' "' + earlier.raw + '" is shadowed by ' +
          later.source + ":" + later.line + ' "' + later.raw + '"',
        advice: "later rules win, so the earlier line can never decide anything; remove it",
      });
      break;
    }
  }

  // Sort for humans: dangerous findings first, then a stable per-kind order
  // (paths alphabetically for files, numeric line numbers for rules).
  const KIND_ORDER: Record<IssueKind, number> = { LEAK: 0, MISSING: 1, CONFLICT: 2, DEAD: 3 };
  issues.sort((a, b) => {
    if (a.kind !== b.kind) return KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
    if (a.kind === "LEAK" || a.kind === "MISSING") {
      if (b.severity !== a.severity) return b.severity - a.severity;
      return String(a.path).localeCompare(String(b.path));
    }
    const sourceDelta = String(a.rule?.source).localeCompare(String(b.rule?.source));
    if (sourceDelta !== 0) return sourceDelta;
    return (a.rule?.line ?? 0) - (b.rule?.line ?? 0);
  });

  const counts: Record<IssueKind, number> = { LEAK: 0, MISSING: 0, DEAD: 0, CONFLICT: 0 };
  for (const issue of issues) counts[issue.kind]++;

  const blocking = options.strict
    ? issues.length > 0
    : counts.LEAK + counts.MISSING > 0;

  return {
    root,
    issues,
    counts,
    scanned,
    ignoreFiles: files.map((file) => file.source),
    gitAvailable,
    failed: blocking,
  };
}

/** Crude "is B a superset of A" test, good enough to spot real shadowing. */
function isStrictlyBroader(later: IgnoreRule, earlier: IgnoreRule): boolean {
  if (later.dirOnly && !earlier.dirOnly) return false;
  if (later.anchored !== earlier.anchored) return false;
  if (!later.dirOnly && earlier.dirOnly) return false;
  if (later.pattern === earlier.pattern) return true;
  if (later.pattern === "**/" + earlier.pattern) return true;
  if (later.pattern === "*" || later.pattern === "**") return true;
  // "*.log" shadows "app.log"; "logs" shadows "logs/old".
  if (/^\*\.[^.]+$/.test(later.pattern) && earlier.pattern.endsWith(later.pattern.slice(1))) return true;
  if (earlier.pattern.startsWith(later.pattern + "/")) return true;
  return false;
}

/** Pick "a"/"an" so generated messages read like English. */
function withArticle(label: string): string {
  return (/^[aeiou]/i.test(label) ? "an " : "a ") + label;
}

function suggestionFor(relative: string): string {
  const name = relative.split("/").pop() ?? relative;
  if (name === ".env") return ".env";
  if (name.startsWith(".env.")) return ".env.*";
  if (/\.(pem|key|p12|pfx)$/i.test(name)) return "*." + (name.split(".").pop() ?? "");
  if (/\.log$/i.test(name)) return "*.log";
  if (relative.split("/").includes("node_modules")) return "node_modules/";
  if (name === ".DS_Store") return ".DS_Store";
  if (/^\.(sqlite|sqlite3|db)$/i.test(name) || /\.(sqlite|sqlite3|db)$/i.test(name)) return "*.db";
  return name;
}
