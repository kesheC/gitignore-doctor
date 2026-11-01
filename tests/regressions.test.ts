/**
 * Regression tests for the bugs a cross review found in 0.1.6.
 *
 * Every claim here is checked against git itself (`git check-ignore -q`)
 * rather than against an expectation this file invents: the whole point of
 * the bugs was that gid disagreed with git.
 */
import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFile, mkdir } from "node:fs/promises";
import * as path from "node:path";

import { explainPath } from "../src/resolve.js";
import { checkRepo } from "../src/check.js";
import { cleanup, git, gitIgnores, makeDirs, makeGitRepo } from "./helpers.js";

const roots: string[] = [];
async function repo(files: Record<string, string>): Promise<string> {
  const root = await makeGitRepo(files);
  roots.push(root);
  return root;
}

afterEach(async () => {
  const pending = roots.splice(0);
  await Promise.all(pending.map((root) => cleanup(root)));
});

describe("B1 .git/info/exclude", () => {
  it("matches rules from .git/info/exclude against the repo root, like git", async () => {
    const root = await repo({ "secret.env": "TOKEN=1\n" });
    await writeFile(path.join(root, ".git", "info", "exclude"), "*.env\n", "utf8");

    expect(gitIgnores(root, "secret.env")).toBe(true);

    const result = await explainPath("secret.env", { cwd: root });
    expect(result.ignored).toBe(true);
    expect(result.rule?.source).toBe(".git/info/exclude");
    expect(result.rule?.line).toBe(1);
    expect(result.rule?.baseDir).toBe("");
  });

  it("keeps .git/info/exclude out of the audit but inside explain", async () => {
    const root = await repo({ "secret.env": "TOKEN=1\n" });
    await writeFile(path.join(root, ".git", "info", "exclude"), "*.env\n", "utf8");
    const report = await checkRepo(root);
    expect(report.ignoreFiles).not.toContain(".git/info/exclude");
  });
});

describe("B2 core.ignorecase", () => {
  it("matches case-insensitively when core.ignorecase is true, like git", async () => {
    const root = await repo({ ".gitignore": "FOO.log\n", "Foo.log": "x\n" });
    git(root, ["config", "core.ignorecase", "true"]);

    expect(gitIgnores(root, "Foo.log")).toBe(true);

    const result = await explainPath("Foo.log", { cwd: root });
    expect(result.ignored).toBe(true);
    expect(result.ignoreCase).toBe(true);
    expect(result.rule?.line).toBe(1);
  });

  it("stays case-sensitive when core.ignorecase is false, like git", async () => {
    const root = await repo({ ".gitignore": "FOO.log\n", "Foo.log": "x\n" });
    git(root, ["config", "core.ignorecase", "false"]);

    expect(gitIgnores(root, "Foo.log")).toBe(false);

    const result = await explainPath("Foo.log", { cwd: root });
    expect(result.ignored).toBe(false);
    expect(result.ignoreCase).toBe(false);
  });

  it("does not report the same file as MISSING and DEAD at once", async () => {
    const root = await repo({ ".gitignore": "FOO.log\n", "Foo.log": "x\n" });
    git(root, ["config", "core.ignorecase", "true"]);
    const report = await checkRepo(root);
    expect(report.counts.MISSING).toBe(0);
    expect(report.counts.DEAD).toBe(0);
  });
});
describe("B3 global excludes", () => {
  it("applies the global excludes file under $HOME when --global is set", async () => {
    const root = await repo({ "demo.log": "x\n" });
    const home = path.join(root, "fakehome");
    await mkdir(path.join(home, ".config", "git"), { recursive: true });
    await writeFile(path.join(home, ".config", "git", "ignore"), "*.log\n", "utf8");

    const saved = { HOME: process.env["HOME"], XDG_CONFIG_HOME: process.env["XDG_CONFIG_HOME"] };
    process.env["HOME"] = home;
    delete process.env["XDG_CONFIG_HOME"];
    try {
      const result = await explainPath("demo.log", { cwd: root, global: true });
      expect(result.ignored).toBe(true);
      expect(result.rule?.baseDir).toBe("");
      expect(result.rule?.source).toContain(".config/git/ignore");

      // Without --global the same path is not ignored: the feature is opt-in.
      const without = await explainPath("demo.log", { cwd: root });
      expect(without.ignored).toBe(false);
    } finally {
      if (saved.HOME === undefined) delete process.env["HOME"];
      else process.env["HOME"] = saved.HOME;
      if (saved.XDG_CONFIG_HOME !== undefined) process.env["XDG_CONFIG_HOME"] = saved.XDG_CONFIG_HOME;
    }
  });
});

describe("M2 negations that can never fire", () => {
  it("reports a CONFLICT when a negation sits under an excluded directory", async () => {
    const root = await repo({
      ".gitignore": "build/\n!build/keep/important.txt\n",
      "build/keep/important.txt": "keep me\n",
    });

    expect(gitIgnores(root, "build/keep/important.txt")).toBe(true);

    const report = await checkRepo(root);
    expect(report.counts.CONFLICT).toBe(1);
    const conflict = report.issues.find((issue) => issue.kind === "CONFLICT");
    expect(conflict?.rule?.line).toBe(2);
    expect(conflict?.message).toContain("can never re-include");

    // --strict must now fail, which it did not before the fix.
    expect(report.failed).toBe(false);
    const strict = await checkRepo(root, { strict: true });
    expect(strict.failed).toBe(true);
  });

  it("does not complain about a negation whose parent is not excluded", async () => {
    const root = await repo({
      ".gitignore": "*.log\n!keep.log\n",
      "keep.log": "x\n",
      "drop.log": "x\n",
    });
    expect(gitIgnores(root, "keep.log")).toBe(false);
    const report = await checkRepo(root);
    expect(report.counts.CONFLICT).toBe(0);
  });
});

describe("M3 check outside a git repository", () => {
  it("reports isRepository false instead of pretending the tree is clean", async () => {
    const root = await repo({ "a.txt": "x\n" });
    // Remove the repository marker: keep the directory, drop .git.
    const { rm } = await import("node:fs/promises");
    await rm(path.join(root, ".git"), { recursive: true, force: true });

    const report = await checkRepo(root);
    expect(report.isRepository).toBe(false);
    expect(report.ignoreFiles.length).toBe(0);
  });
});

describe("M1 DEAD advice", () => {
  it("does not tell the user to delete defensive rules by default", async () => {
    const root = await repo({ ".gitignore": "coverage/\n", "a.txt": "x\n" });
    const report = await checkRepo(root);
    const dead = report.issues.find((issue) => issue.kind === "DEAD");
    expect(dead?.message).toContain("matches no file right now");
    expect(dead?.advice).toContain("defensive rules");
    expect(dead?.advice).not.toContain("delete the rule");

    const verbose = await checkRepo(root, { verbose: true });
    const loud = verbose.issues.find((issue) => issue.kind === "DEAD");
    expect(loud?.advice).toContain("delete the rule");
  });
});

describe("M5 node template completeness", () => {
  it("generates build artefacts rules for a node project", async () => {
    const root = await repo({ "package.json": "{}\n", "tsconfig.json": "{}\n" });
    const { generateIgnoreFile } = await import("../src/init.js");
    const result = await generateIgnoreFile(root);
    expect(result.stacks.map((stack) => stack.id)).toContain("node");
    for (const expected of ["dist/", "build/", "coverage/", "*.tsbuildinfo", ".eslintcache"]) {
      expect(result.content).toContain(expected);
    }
  });
});
describe("CLI exit codes (M3 M4 M6)", () => {
  const CLI = path.resolve("dist/cli.js");

  function runCli(args: string[], cwd: string): { code: number; stdout: string; stderr: string } {
    try {
      const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
      return { code: 0, stdout, stderr: "" };
    } catch (error) {
      const failure = error as { status?: number; stdout?: string; stderr?: string };
      return { code: failure.status ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
    }
  }

  it("exits 2 from check outside a git repository", async () => {
    const root = await repo({ "a.txt": "x\n" });
    const { rm } = await import("node:fs/promises");
    await rm(path.join(root, ".git"), { recursive: true, force: true });
    const result = runCli(["check"], root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("not a git repository");
  });

  it("exits 2 from init outside a git repository and writes nothing", async () => {
    const root = await repo({ "package.json": "{}\n" });
    const { rm, access } = await import("node:fs/promises");
    await rm(path.join(root, ".git"), { recursive: true, force: true });
    const result = runCli(["init"], root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("not a git repository");
    await expect(access(path.join(root, ".gitignore"))).rejects.toThrow();
  });

  // --flag=value is the spelling half the world types first; the parser only
  // knew "--flag value", so "--cwd=." was reported as unknown.
  it("accepts the --flag=value spelling", async () => {
    const root = await repo({ ".gitignore": "*.log\n" });
    const result = runCli(["list", "--cwd=.", "--json"], root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("*.log");
  });

  it("refuses a value on a flag that has none", async () => {
    const root = await repo({ ".gitignore": "*.log\n" });
    const result = runCli(["list", "--why=1"], root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("--why does not take a value");
  });

  it("exits 2 on a misspelled option instead of silently ignoring it", async () => {
    const root = await repo({ ".gitignore": "*.log\n" });
    for (const args of [["check", "--stict"], ["check", "--unknown"], ["list", "--nope"]]) {
      const result = runCli(args, root);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("unknown option");
    }
  });

  it("blames the path, not git, when --cwd is not there", async () => {
    // `list` used to print "No ignore rules found" and exit 0 for a directory
    // that does not exist, and the other commands said "not a git repository",
    // which sends the reader looking at git when the path is the problem.
    const root = await repo({ ".gitignore": "*.log\n" });
    const missing = path.join(root, "no-such-subdir");
    for (const command of ["list", "check", "explain"]) {
      const args = command === "explain" ? [command, "a.log", "--cwd", missing] : [command, "--cwd", missing];
      const result = runCli(args, root);
      expect(result.code).toBe(2);
      expect(result.stderr).toContain("no such directory");
      expect(result.stderr).not.toContain("not a git repository");
    }
  });

  it("says not a directory when --cwd points at a file", async () => {
    const root = await repo({ ".gitignore": "*.log\n", "notes.txt": "x\n" });
    const result = runCli(["list", "--cwd", path.join(root, "notes.txt")], root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("not a directory");
  });

  it("still calls a real directory without a repository what it is", async () => {
    const root = await makeDirs([]);
    roots.push(root);
    const result = runCli(["check", "--cwd", root], root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("not a git repository");
  });

  it("treats everything after -- as a path, so a name that starts with a dash can be explained", async () => {
    const root = await repo({ ".gitignore": "--weird-name\n" });
    const result = runCli(["explain", "--", "--weird-name"], root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("--weird-name");
    expect(result.stdout).toContain("ignored");
  });
});
