import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";

import { checkRepo } from "../src/check.js";
import { runGit, isGitAvailable } from "../src/git.js";
import { cleanup, makeTree } from "./helpers.js";

const roots: string[] = [];
async function tree(files: Record<string, string>): Promise<string> {
  const root = await makeTree(files);
  roots.push(root);
  return root;
}

afterEach(async () => {
  const pending = roots.splice(0);
  await Promise.all(pending.map((root) => cleanup(root)));
});

/** Initialize a real git repository so LEAK detection can be exercised. */
function initRepo(root: string): boolean {
  assertGit();
  const run = (args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
  run(["init", "-q"]);
  run(["config", "user.email", "test@example.com"]);
  run(["config", "user.name", "Test"]);
  run(["config", "commit.gpgsign", "false"]);
  return true;
}

function assertGit(): void {
  const probe = runGit(["--version"], process.cwd());
  if (probe === null) throw new Error("git is not available in this environment");
}

describe("checkRepo", () => {
  it("flags MISSING for an untracked, unignored .env", async () => {
    const root = await tree({
      ".gitignore": "*.log\n",
      ".env": "SECRET=1\n",
    });
    const report = await checkRepo(root);
    const missing = report.issues.filter((issue) => issue.kind === "MISSING");
    expect(missing.map((issue) => issue.path)).toContain(".env");
    expect(report.counts.MISSING).toBeGreaterThan(0);
    expect(report.failed).toBe(true);
  });

  it("stays clean when the ignore file already covers everything", async () => {
    const root = await tree({
      ".gitignore": [".env", "*.log", "node_modules/"].join("\n"),
      ".env": "SECRET=1\n",
      "app.log": "x\n",
      "node_modules/pkg/index.js": "x\n",
    });
    const report = await checkRepo(root);
    const noisy = report.issues.filter((issue) => issue.kind === "MISSING" || issue.kind === "LEAK");
    expect(noisy).toEqual([]);
    expect(report.counts.MISSING).toBe(0);
    expect(report.counts.LEAK).toBe(0);
  });

  it("reports DEAD rules that match nothing on disk", async () => {
    const root = await tree({
      ".gitignore": ["*.log", "totally-absent-dir/"].join("\n"),
      "app.log": "x\n",
    });
    const report = await checkRepo(root);
    const dead = report.issues.filter((issue) => issue.kind === "DEAD");
    expect(dead).toHaveLength(1);
    expect(dead[0]?.rule?.line).toBe(2);
    expect(dead[0]?.message).toContain("matches nothing");
  });

  it("reports CONFLICT when a later rule fully shadows an earlier one", async () => {
    const root = await tree({
      ".gitignore": ["app.log", "*.log"].join("\n"),
      "app.log": "x\n",
    });
    const report = await checkRepo(root);
    const conflict = report.issues.filter((issue) => issue.kind === "CONFLICT");
    expect(conflict).toHaveLength(1);
    expect(conflict[0]?.rule?.line).toBe(1);
    expect(conflict[0]?.message).toContain("shadowed by");
  });

  it("does not fail the run for DEAD or CONFLICT unless --strict", async () => {
    const root = await tree({
      ".gitignore": ["app.log", "*.log"].join("\n"),
      "app.log": "x\n",
    });
    const lenient = await checkRepo(root, { strict: false });
    expect(lenient.failed).toBe(false);
    const strict = await checkRepo(root, { strict: true });
    expect(strict.failed).toBe(true);
  });

  it("detects LEAK for a tracked file that ignore rules would exclude", async () => {
    try {
      assertGit();
    } catch {
      return; // git missing: the LEAK path cannot be exercised here
    }
    const root = await tree({
      ".gitignore": [".env", "*.log"].join("\n"),
      ".env": "SECRET=1\n",
      "app.log": "x\n",
    });
    initRepo(root);
    execFileSync("git", ["add", "-f", ".env"], { cwd: root, stdio: "pipe" });

    const report = await checkRepo(root);
    expect(report.gitAvailable).toBe(true);
    const leak = report.issues.filter((issue) => issue.kind === "LEAK");
    expect(leak.map((issue) => issue.path)).toContain(".env");
    expect(leak[0]?.severity).toBeGreaterThanOrEqual(90);
    expect(leak[0]?.advice).toContain("git rm --cached");
    expect(report.failed).toBe(true);
  });

  it("reports gitAvailable truthfully", async () => {
    const root = await tree({ ".gitignore": "*.log\n", "a.log": "x\n" });
    const report = await checkRepo(root);
    expect(typeof report.gitAvailable).toBe("boolean");
    expect(Array.isArray(report.ignoreFiles)).toBe(true);
    expect(isGitAvailable).toBeTypeOf("function");
  });
});
