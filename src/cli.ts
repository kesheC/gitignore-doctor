#!/usr/bin/env node
/**
 * Command line entry point for `gid`.
 *
 * This file only parses arguments and prints; every decision lives in the
 * library modules so it can be reused and tested without a process.
 */
import { realpathSync } from "node:fs";
import { readdir, stat, writeFile } from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import {
  explainPath,
  findRepoRoot,
  findRepoRootOrNull,
  collectIgnoreFiles,
  flattenRules,
  normalizeTarget,
} from "./resolve.js";
import { relativeWithin } from "./matcher.js";
import { checkRepo } from "./check.js";
import { abbreviatePattern } from "./rules.js";
import { generateIgnoreFile, ignoreFileTarget, listStacks } from "./init.js";
import { matchPath } from "./matcher.js";
import type { ExplainResult, Issue, IssueKind } from "./types.js";
import { installPipeGuard } from "./pipe.js";

const VERSION = "0.1.23";

const HELP = `gid - explain & audit .gitignore rules

Usage:
  gid explain <path> [--json] [--global] [--cwd <dir>]
  gid check [--strict] [--json] [--cwd <dir>]
  gid list [--why] [--json] [--cwd <dir>]
  gid init [--detect] [--force] [--json] [--cwd <dir>]

Commands:
  explain   Explain whether a path is ignored, which rule won, and why.
  check     Audit the repository: LEAK / MISSING / INVALID / DEAD / CONFLICT
            findings.
  list      List every active rule with the number of files it matches.
  init      Generate a .gitignore from detected stacks.

Options:
  --cwd <dir>   Run as if started in <dir>. Defaults to the current directory.
  --json        Machine readable output.
  --global      Also apply core.excludesFile / ~/.config/git/ignore.
  --strict      In check: treat INVALID, DEAD and CONFLICT as failures too.
  --all         In check: print every finding (the default prints 8 per kind,
                then a line saying how many more there are).
  --verbose     In check: blunt advice for DEAD rules (default advice says a
                dead rule may just be waiting for an accident).
  --why         In list: add a per-rule explanation.
  --force       In init: overwrite an existing .gitignore.
  -h, --help    Show this help.
  -v, --version Show the version. Top level only: not after a command.

Exit codes:
  0  clean / explained successfully
  1  check found blocking issues
  2  usage error
`;

interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Set<string>;
  values: Map<string, string>;
}

/**
 * Say what is actually wrong with --cwd.
 *
 * Returns null when the directory is usable. The point is to keep the three
 * failure modes apart: a missing path, a path that is a file, and a real
 * directory that simply is not a git work tree. Only the last one is the
 * git problem, and it is reported further down by the commands that need a
 * repository.
 */
async function checkDirectory(cwd: string): Promise<string | null> {
  const resolved = path.resolve(cwd);
  let info;
  try {
    info = await stat(resolved);
  } catch {
    return "no such directory: " + resolved;
  }
  if (!info.isDirectory()) return "not a directory: " + resolved;
  return null;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  const positional: string[] = [];
  const takesValue = new Set(["cwd"]);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    // Everything after -- is a positional, even when it looks like a flag.
    // Without this, `gid explain -- --weird-name` was a usage error, so a file
    // whose name starts with a dash could not be explained at all.
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      // --flag=value is the spelling everyone reaches for; splitting it here
      // keeps "unknown option for 'gid list': --cwd=." from being the answer.
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      const name = eq >= 0 ? body.slice(0, eq) : body;
      const inline = eq >= 0 ? body.slice(eq + 1) : undefined;
      if (takesValue.has(name)) {
        if (inline !== undefined) {
          values.set(name, inline);
          continue;
        }
        const next = argv[i + 1];
        if (next === undefined) throw new UsageError("--" + name + " needs a value");
        values.set(name, next);
        i++;
      } else {
        if (inline !== undefined) throw new UsageError("--" + name + " does not take a value");
        flags.add(name);
      }
      continue;
    }
    if (arg.startsWith("-") && arg.length > 1) {
      const short = arg.slice(1);
      if (short === "h") flags.add("help");
      else if (short === "v") flags.add("version");
      else throw new UsageError("unknown option: " + arg);
      continue;
    }
    positional.push(arg);
  }

  return { command: positional.shift() ?? "", positional, flags, values };
}

class UsageError extends Error {}

/** Options each subcommand understands; anything else is a usage error. */
const COMMAND_OPTIONS: Record<string, string[]> = {
  explain: ["cwd", "json", "global"],
  check: ["cwd", "json", "strict", "all", "verbose"],
  list: ["cwd", "json", "why", "global"],
  init: ["cwd", "json", "detect", "force"],
};

/** Flags that mean the same thing on every command. */
const GLOBAL_FLAGS = ["help", "version"];

/**
 * Reject flags the chosen subcommand does not implement.
 *
 * `--help` and `--version` are accepted everywhere; everything else must be
 * declared for the command. Checking this before the help branch matters: with
 * the help branch first, `gid list --stict` printed the help text and exited 0,
 * so a misspelled flag looked accepted.
 */
function assertKnownOptions(command: string, args: ParsedArgs): void {
  const declared = COMMAND_OPTIONS[command];
  const permitted = new Set([...(declared ?? []), ...GLOBAL_FLAGS]);
  const where = declared === undefined ? "gid" : "gid " + command;
  for (const flag of args.flags) {
    if (permitted.has(flag)) continue;
    throw new UsageError("unknown option for '" + where + "': --" + flag);
  }
  for (const name of args.values.keys()) {
    if (permitted.has(name)) continue;
    throw new UsageError("unknown option for '" + where + "': --" + name);
  }
}

/**
 * Whether the line asks for machine output, judged from the raw tokens.
 *
 * The failure paths need this before a command has been parsed: a bad option,
 * a bad --cwd and an unknown command all happen before the switch, and a
 * caller that passed --json still asked for a document.
 */
function wantsJson(argv: string[]): boolean {
  for (const token of argv) {
    if (token === "--") break;
    if (token === "--json") return true;
    if (token.startsWith("--json=")) return token.slice("--json=".length) !== "false";
  }
  return false;
}

/**
 * Report one failure twice: the sentence a person reads on stderr and the
 * document a wrapper parses on stdout.
 *
 * `gid check --json --cwd /missing` used to answer with a bare string under
 * "error" on one path and with nothing at all on the others, so a script could
 * not read every failure the same way. The shape now matches apidiff,
 * envpulse, jsonl-beaver and repropack: {"error":{"message":...,"exitCode":n}}.
 */
function reportFailure(message: string, exitCode: number, wantJson: boolean): number {
  if (wantJson) {
    process.stdout.write(JSON.stringify({ error: { message, exitCode } }, null, 2) + "\n");
  }
  process.stderr.write("gid: " + message + "\n");
  return exitCode;
}

async function main(argv: string[]): Promise<number> {
  const wantJson = wantsJson(argv);
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (error) {
    return reportFailure((error as Error).message, 2, wantJson);
  }

  // An unknown command is answered before its options. `gid nosuchcommand
  // --json` used to come back as "unknown option for 'gid': --json", blaming
  // the flag for a command that does not exist at all.
  if (args.command !== "" && !Object.hasOwn(COMMAND_OPTIONS, args.command)) {
    const message = "unknown command '" + args.command + "'";
    if (wantJson) {
      process.stdout.write(JSON.stringify({ error: { message, exitCode: 2 } }, null, 2) + "\n");
    }
    process.stderr.write("gid: " + message + "\n\n" + HELP);
    return 2;
  }

  // Unknown options are reported before help or version so a typo can never
  // exit 0. A bare "gid --bogus" used to print the whole help text on stdout
  // and still exit 2, which is the worst of both: the message a script cannot
  // read, and the exit code of a usage error.
  try {
    assertKnownOptions(args.command, args);
  } catch (error) {
    return reportFailure((error as Error).message, 2, wantJson);
  }

  // --version is checked before the help fallback, otherwise a bare
  // "gid --version" (no subcommand) would be treated as a usage error.
  if (args.flags.has("version")) {
    if (args.command !== "") {
      return reportFailure(
        "--version is not supported by 'gid " + args.command + "'; it applies to \"gid --version\" on its own",
        2,
        wantJson,
      );
    }
    process.stdout.write(VERSION + "\n");
    return 0;
  }
  if (args.flags.has("help") || args.command === "") {
    process.stdout.write(HELP);
    return args.flags.has("help") ? 0 : 2;
  }

  const cwd = args.values.get("cwd") ?? process.cwd();
  const json = args.flags.has("json");

  // A --cwd that does not exist used to fall through to "not a git
  // repository", which points the reader at git when the real problem is the
  // path. `list` was worse: it printed "No ignore rules found" and exited 0.
  const cwdProblem = await checkDirectory(cwd);
  if (cwdProblem !== null) {
    return reportFailure(cwdProblem, 2, wantJson);
  }

  try {
    switch (args.command) {
      case "explain":
        return await runExplain(args, cwd, json);
      case "check":
        return await runCheck(args, cwd, json);
      case "list":
        return await runList(args, cwd, json);
      case "init":
        return await runInit(args, cwd, json);
      default:
        process.stderr.write("gid: unknown command '" + args.command + "'\n\n" + HELP);
        return 2;
    }
  } catch (error) {
    if (error instanceof UsageError) return reportFailure(error.message, 2, wantJson);
    return reportFailure((error as Error).message, 1, wantJson);
  }
}

async function runExplain(args: ParsedArgs, cwd: string, json: boolean): Promise<number> {
  const target = args.positional[0];
  if (!target) throw new UsageError("explain needs a <path>");

  const result = await explainPath(target, { cwd, global: args.flags.has("global") });

  if (json) {
    process.stdout.write(JSON.stringify(toExplainJson(result), null, 2) + "\n");
    return 0;
  }

  const lines: string[] = [];
  lines.push("path:   " + result.path + (result.isDir ? "/" : ""));
  lines.push("status: " + (result.ignored ? "ignored" : "not ignored"));
  if (result.rule) {
    const rule = result.rule;
    const shape = rule.dirOnly ? "directory-only match" : "match";
    const where = result.viaAncestor
      ? "on ancestor \"" + (result.matchedPath ?? "") + "\""
      : result.isDir
        ? "on this directory"
        : "on this file";
    lines.push("rule:   " + rule.source + ":" + rule.line + "  \"" + abbreviatePattern(rule.raw) + "\"  (" + shape + " " + where + ")");
    if (rule.patternError !== null) {
      lines.push("warn:   this pattern cannot be compiled (" + rule.patternError + "), so it matches nothing");
    }
  } else {
    lines.push("rule:   (none)");
  }
  lines.push("chain:  " + renderChain(result));
  if (result.tracked !== null) {
    lines.push("git:    " + (result.tracked ? "tracked" : "untracked"));
  }
  if (result.whitelistedBy) {
    lines.push("warn:   \"" + result.whitelistedBy.raw + "\" at " + result.whitelistedBy.source + ":" + result.whitelistedBy.line + " would re-include it, but a parent directory is excluded first");
  }
  if (!result.exists) {
    lines.push("note:   " + (result.note ?? result.reason) + " (the path does not exist on disk; rules are still evaluated)");
  } else {
    lines.push("note:   " + (result.note ?? result.reason));
  }
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

function renderChain(result: ExplainResult): string {
  if (result.chain.length === 0) return "(nothing evaluated)";
  return result.chain
    .map((step) => {
      const label = step.rule ? step.rule.source + "#" + step.rule.line : "-";
      return step.path + " -> " + label + " (" + step.result + ")";
    })
    .join(" | ");
}

function toExplainJson(result: ExplainResult): Record<string, unknown> {
  return {
    path: result.path,
    ignored: result.ignored,
    source: result.rule ? result.rule.source : null,
    line: result.rule ? result.rule.line : null,
    pattern: result.rule ? result.rule.pattern : null,
    patternError: result.rule ? result.rule.patternError : null,
    reason: result.reason,
    whitelistedBy: result.whitelistedBy
      ? {
          source: result.whitelistedBy.source,
          line: result.whitelistedBy.line,
          pattern: result.whitelistedBy.pattern,
        }
      : null,
    matchedPath: result.matchedPath,
    viaAncestor: result.viaAncestor,
    isDir: result.isDir,
    exists: result.exists,
    tracked: result.tracked,
    note: result.note,
  };
}

async function runCheck(args: ParsedArgs, cwd: string, json: boolean): Promise<number> {
  const report = await checkRepo(cwd, {
    strict: args.flags.has("strict"),
    verbose: args.flags.has("verbose"),
  });

  if (!report.isRepository) {
    const message =
      "not a git repository: " + report.root + " (check audits a git work tree; run git init first)";
    if (json) {
      process.stdout.write(
        JSON.stringify({ root: report.root, isRepository: false, error: message }, null, 2) + "\n",
      );
    }
    process.stderr.write("gid: " + message + "\n");
    return 2;
  }

  if (json) {
    process.stdout.write(
      JSON.stringify(
        {
          root: report.root,
          failed: report.failed,
          gitAvailable: report.gitAvailable,
          counts: report.counts,
          scanned: report.scanned,
          issues: report.issues.map((issue) => ({
            kind: issue.kind,
            severity: issue.severity,
            path: issue.path,
            source: issue.rule ? issue.rule.source : null,
            line: issue.rule ? issue.rule.line : null,
            pattern: issue.rule ? issue.rule.pattern : null,
            message: issue.message,
            advice: issue.advice,
          })),
        },
        null,
        2,
      ) + "\n",
    );
    return report.failed ? 1 : 0;
  }

  const lines: string[] = [];
  lines.push("repository: " + report.root);
  lines.push(
    "scanned:    " + report.scanned + " entries, " + report.ignoreFiles.length + " ignore file(s)" +
      (report.gitAvailable ? "" : " (git not available: LEAK check skipped)"),
  );
  lines.push("");

  if (report.issues.length === 0) {
    lines.push("No issues found. Your .gitignore is doing its job.");
  } else {
    // DEAD rules are the noisiest and least urgent class, so the human output
    // shows the first few and offers --all; JSON output is always complete.
    const limit = args.flags.has("all") ? Number.POSITIVE_INFINITY : 8;
    const seen = new Map<IssueKind, number>();
    let currentKind: IssueKind | null = null;
    for (const issue of report.issues) {
      if (issue.kind !== currentKind) {
        currentKind = issue.kind;
        seen.set(currentKind, 0);
        lines.push(sectionTitle(currentKind) + " (" + report.counts[currentKind] + ")");
      }
      const count = (seen.get(issue.kind) ?? 0) + 1;
      seen.set(issue.kind, count);
      if (count > limit) continue;
      lines.push("  " + renderIssue(issue));
    }
    for (const kind of ["LEAK", "MISSING", "INVALID", "CONFLICT", "DEAD"] as IssueKind[]) {
      const hidden = report.counts[kind] - Math.min(report.counts[kind], limit);
      if (hidden > 0) lines.push("  ... and " + hidden + " more " + kind + " finding(s); use --all to see them");
    }
    lines.push("");
    const blocking = report.counts.LEAK + report.counts.MISSING;
    lines.push(
      "summary: " + report.counts.LEAK + " leak, " + report.counts.MISSING + " missing, " +
        report.counts.INVALID + " invalid, " + report.counts.DEAD + " dead, " +
        report.counts.CONFLICT + " conflict",
    );
    lines.push(
      report.failed
        ? "result:  FAIL (" + (args.flags.has("strict") ? "strict mode" : blocking + " blocking") + ")"
        : "result:  PASS (only informational findings; use --strict to fail on them)",
    );
  }

  process.stdout.write(lines.join("\n") + "\n");
  return report.failed ? 1 : 0;
}

function sectionTitle(kind: IssueKind): string {
  switch (kind) {
    case "LEAK":
      return "LEAK - tracked despite being ignored";
    case "MISSING":
      return "MISSING - should be ignored but is not";
    case "INVALID":
      return "INVALID - rules that cannot be compiled";
    case "DEAD":
      return "DEAD - rules that match nothing";
    case "CONFLICT":
      return "CONFLICT - rules shadowed by later rules or parent directories";
  }
}

function renderIssue(issue: Issue): string {
  const location = issue.path ?? (issue.rule ? issue.rule.source + ":" + issue.rule.line : "");
  return "[" + issue.kind + "] " + location + "\n        " + issue.message + "\n        fix: " + issue.advice;
}

async function runList(args: ParsedArgs, cwd: string, json: boolean): Promise<number> {
  const root = await findRepoRoot(cwd);
  const files = await collectIgnoreFiles(root, { global: args.flags.has("global") });
  const rules = flattenRules(files);

  const hits = new Map<string, number>();
  const target = normalizeTarget(root, args.positional[0] ?? ".", cwd);
  for (const rule of rules) hits.set(rule.source + ":" + rule.line, 0);

  // Directories nobody wants counted inside (.git) or walked into for speed
  // (node_modules): the directory entry itself still counts as a hit, which is
  // what makes "node_modules/" report a non-zero match count.
  const NO_DESCEND = new Set(["node_modules"]);
  const walk = async (relativeDir: string): Promise<void> => {
    const absoluteDir = relativeDir === "" ? root : path.join(root, relativeDir.split("/").join(path.sep));
    let names: string[];
    try {
      names = await readdir(absoluteDir);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === ".git") continue;
      const relative = relativeDir === "" ? name : relativeDir + "/" + name;
      let isDir = false;
      try {
        isDir = (await stat(path.join(absoluteDir, name))).isDirectory();
      } catch {
        continue;
      }
      for (const rule of rules) {
        const within = rule.baseDir === "" ? relative : relativeWithin(relative, rule.baseDir);
        if (within === null || within === "") continue;
        if (rule.dirOnly && !isDir) continue;
        if (rule.regex.test(within)) {
          const key = rule.source + ":" + rule.line;
          hits.set(key, (hits.get(key) ?? 0) + 1);
        }
      }
      if (isDir && !NO_DESCEND.has(name)) await walk(relative);
    }
  };
  await walk(target === "." ? "" : target);

  if (json) {
    process.stdout.write(
      JSON.stringify(
        rules.map((rule) => ({
          source: rule.source,
          line: rule.line,
          pattern: rule.pattern,
          raw: rule.raw,
          negated: rule.negated,
          dirOnly: rule.dirOnly,
          anchored: rule.anchored,
          patternError: rule.patternError,
          hits: hits.get(rule.source + ":" + rule.line) ?? 0,
        })),
        null,
        2,
      ) + "\n",
    );
    return 0;
  }

  if (rules.length === 0) {
    process.stdout.write("No ignore rules found under " + root + "\n");
    return 0;
  }

  const lines: string[] = [];
  lines.push("repository: " + root);
  lines.push("");
  let currentSource = "";
  for (const rule of rules) {
    if (rule.source !== currentSource) {
      if (currentSource !== "") lines.push("");
      currentSource = rule.source;
      lines.push(currentSource);
    }
    const count = hits.get(rule.source + ":" + rule.line) ?? 0;
    const marker =
      rule.patternError !== null ? "  (invalid pattern: matches nothing)" : count === 0 ? "  (matches 0)" : "";
    lines.push(
      "  " + String(rule.line).padStart(4) + "  " + abbreviatePattern(rule.raw, 60).padEnd(34) +
        String(count).padStart(6) + marker,
    );
    if (args.flags.has("why")) {
      const bits = [rule.negated ? "re-include" : "ignore"];
      if (rule.dirOnly) bits.push("directories only");
      if (rule.anchored) bits.push("anchored to " + (rule.baseDir || "."));
      else bits.push("matches at any depth");
      lines.push("        why: " + bits.join(", "));
    }
  }
  lines.push("");
  lines.push("total: " + rules.length + " rule(s)");
  lines.push("hits = files whose name matches the pattern, counted before later rules win; they are not the number of files this rule actually ignores.");
  process.stdout.write(lines.join("\n") + "\n");
  return 0;
}

async function runInit(args: ParsedArgs, cwd: string, json: boolean): Promise<number> {
  const root = await findRepoRootOrNull(cwd);
  if (root === null) {
    const message =
      "not a git repository: " + path.resolve(cwd) + " (run git init first, or pass --cwd)";
    if (json) {
      process.stdout.write(JSON.stringify({ error: message }, null, 2) + "\n");
    }
    process.stderr.write("gid: " + message + "\n");
    return 2;
  }
  const target = ignoreFileTarget(root);

  if (!args.flags.has("force")) {
    const { access } = await import("node:fs/promises");
    try {
      await access(target);
      if (!json) {
        process.stderr.write("gid: " + target + " already exists; use --force to overwrite\n");
      }
      return 2;
    } catch {
      // missing is fine
    }
  }

  // Detection is always on: the flag exists to be explicit, and the evidence
  // printed below is what justifies each generated section.
  const result = await generateIgnoreFile(root);
  await writeFile(target, result.content, "utf8");

  if (json) {
    process.stdout.write(
      JSON.stringify({ path: target, stacks: result.stacks, bytes: result.content.length }, null, 2) + "\n",
    );
    return 0;
  }

  process.stdout.write("wrote " + target + "\n");
  if (result.stacks.length === 0) {
    process.stdout.write("detected: nothing specific (baseline rules only)\n");
  } else {
    process.stdout.write("detected:\n");
    for (const stack of result.stacks) {
      process.stdout.write("  " + stack.id.padEnd(12) + " <- " + stack.evidence.join(", ") + "\n");
    }
  }
  return 0;
}

// realpathSync on both sides: npm links the bin shim to this file, so
// process.argv[1] is the symlink while import.meta.url is already the real
// path. Comparing raw paths makes the CLI exit silently doing nothing.
const isMain = (() => {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();

installPipeGuard();

if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write("gid: " + (error as Error).message + "\n");
      process.exitCode = 1;
    },
  );
}

export { main };