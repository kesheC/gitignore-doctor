/** Thin, failure tolerant wrappers around the git CLI. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const EXEC_OPTIONS = {
  maxBuffer: 64 * 1024 * 1024,
  windowsHide: true,
  timeout: 30_000,
} as const;

/**
 * Run a git command. Returns null when git is missing or the command fails,
 * so callers can degrade gracefully instead of crashing.
 */
export async function runGit(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, { ...EXEC_OPTIONS, cwd });
    return stdout;
  } catch {
    return null;
  }
}

/** Read one git config value, or null when it is unset / git is unavailable. */
export async function gitConfigValue(root: string, key: string): Promise<string | null> {
  const out = await runGit(["config", "--get", key], root);
  if (out === null) return null;
  const value = out.trim();
  return value === "" ? null : value;
}

/**
 * Whether git compares paths case-insensitively in this repository.
 *
 * `git init` turns `core.ignorecase` on for case-insensitive filesystems
 * (Windows, default macOS) but leaves it off on Linux, so the answer has to
 * come from git itself. Without a repository (or without git) we fall back to
 * the platform default, which is what `git init` would have chosen anyway.
 */
export async function isCaseInsensitive(
  root: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  const configured = await gitConfigValue(root, "core.ignorecase");
  if (configured !== null) return configured.toLowerCase() === "true";
  return platform === "win32" || platform === "darwin";
}

/** True when the git CLI is installed and answers questions. */
export async function isGitAvailable(cwd: string): Promise<boolean> {
  return (await runGit(["--version"], cwd)) !== null;
}

/** True when `cwd` is inside a git working tree. */
export async function isGitRepository(cwd: string): Promise<boolean> {
  const out = await runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  return out !== null && out.trim() === "true";
}

/** All tracked files, as POSIX paths relative to the given directory. */
export async function listTrackedFiles(root: string): Promise<string[] | null> {
  const out = await runGit(["ls-files", "-z", "--cached"], root);
  if (out === null) return null;
  return out.split("\0").filter((entry) => entry.length > 0);
}

/** True when exactly this path is tracked by git. */
export async function isTracked(root: string, relativePath: string): Promise<boolean | null> {
  const out = await runGit(["ls-files", "-z", "--cached", "--", relativePath], root);
  if (out === null) return null;
  return out.split("\0").some((entry) => entry.length > 0);
}

/**
 * Ask git for the verdict on a path, or null when git could not answer.
 *
 * `check-ignore -q` is the only correct ground truth: with `-v` git also
 * prints (and exits 0 for) a rule that merely *un-ignores* the path, so a
 * negated rule would look like "ignored". `-q` exits 0 only when the path is
 * actually excluded.
 *
 * Used for cross checking in tests; the main implementation never relies on it.
 */
export async function gitCheckIgnore(root: string, relativePath: string): Promise<boolean | null> {
  try {
    await execFileAsync("git", ["check-ignore", "-q", "--no-index", "--", relativePath], {
      ...EXEC_OPTIONS,
      cwd: root,
    });
    return true;
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 1) return false;
    return null;
  }
}

/** The rule git says wins, as `source:line:pattern`, or null when not ignored. */
export async function gitCheckIgnoreVerbose(root: string, relativePath: string): Promise<string | null> {
  const out = await runGit(["check-ignore", "-v", "--no-index", "--", relativePath], root);
  if (out === null) return null;
  const line = out.split("\n")[0]?.trim() ?? "";
  return line === "" ? null : line;
}

/** Resolve core.excludesFile, honouring a leading `~`. */
export async function globalExcludesFile(root: string, home: string): Promise<string | null> {
  const configured = await gitConfigValue(root, "core.excludesFile");
  if (configured === null) return null;
  if (configured.startsWith("~/") || configured.startsWith("~\\")) {
    return configured.slice(2).split(/[\\/]/).reduce((acc, part) => acc + "/" + part, home);
  }
  return configured;
}
