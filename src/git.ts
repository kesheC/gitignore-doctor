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
 * Ask git for the verdict on a path. Used only for cross checking in tests and
 * for `gid list --verify`; the main implementation never relies on it.
 */
export async function gitCheckIgnore(root: string, relativePath: string): Promise<boolean | null> {
  try {
    const out = await runGit(["check-ignore", "-v", "--no-index", "--", relativePath], root);
    return out !== null && out.trim().length > 0;
  } catch {
    return null;
  }
}

/** Resolve core.excludesFile, honouring a leading `~`. */
export async function globalExcludesFile(root: string, home: string): Promise<string | null> {
  const configured = await runGit(["config", "--get", "core.excludesFile"], root);
  if (configured === null || configured.trim() === "") return null;
  const value = configured.trim();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return value.slice(2).split(/[\\/]/).reduce((acc, part) => acc + "/" + part, home);
  }
  return value;
}
