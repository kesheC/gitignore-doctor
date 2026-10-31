import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

/** Create a throwaway directory tree and return its absolute root. */
export async function makeTree(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gid-test-"));
  for (const [relative, content] of Object.entries(files)) {
    const absolute = path.join(root, relative.split("/").join(path.sep));
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
  }
  return root;
}

/** Create a throwaway directory with the given (empty) directories. */
export async function makeDirs(dirs: string[]): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gid-test-"));
  for (const relative of dirs) {
    await mkdir(path.join(root, relative.split("/").join(path.sep)), { recursive: true });
  }
  return root;
}

/** Run git in a directory, returning trimmed stdout. */
export function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: "pipe" }).trim();
}

/** Run git and report its exit code instead of throwing. */
export function gitCode(cwd: string, args: string[]): number {
  try {
    execFileSync("git", args, { cwd, stdio: "pipe" });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

/**
 * Build a temp tree and turn it into a real git repository.
 *
 * Real git matters here: the regression tests use `git check-ignore -q` as
 * the ground truth, so the fixture has to be something git itself accepts.
 */
export async function makeGitRepo(
  files: Record<string, string>,
  options: { branch?: string } = {},
): Promise<string> {
  const root = await makeTree(files);
  git(root, ["init", "-q", "-b", options.branch ?? "main"]);
  git(root, ["config", "user.email", "test@example.com"]);
  git(root, ["config", "user.name", "gid tests"]);
  git(root, ["config", "commit.gpgsign", "false"]);
  return root;
}

/** True when `git check-ignore -q` says the path is ignored (exit 0). */
export function gitIgnores(cwd: string, relative: string): boolean {
  return gitCode(cwd, ["check-ignore", "-q", "--no-index", "--", relative]) === 0;
}

/** Remove a temp tree, ignoring failures. */
export async function cleanup(root: string): Promise<void> {
  await rm(root, { recursive: true, force: true });
}
