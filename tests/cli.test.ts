import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import * as path from "node:path";

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

const CLI = path.resolve("dist/cli.js");
const BUILT = existsSync(CLI);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run the built CLI, capturing the exit code instead of throwing. */
function run(args: string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
    return { code: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failure.status ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

describe.skipIf(!BUILT)("gid CLI", () => {
  it("prints help and exits 0 for --help", async () => {
    const root = await tree({});
    const result = run(["--help"], root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("gid - explain & audit .gitignore rules");
    expect(result.stdout).toContain("gid explain <path>");
  });

  it("prints the version for --version", async () => {
    const root = await tree({});
    const result = run(["--version"], root);
    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("exits 2 on an unknown command", async () => {
    const root = await tree({});
    const result = run(["frobnicate"], root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("unknown command");
  });

  it("exits 2 when explain is missing its path", async () => {
    const root = await tree({ ".gitignore": "*.log\n" });
    const result = run(["explain"], root);
    expect(result.code).toBe(2);
    expect(result.stderr).toContain("needs a <path>");
  });

  it("explains a path as text and as JSON", async () => {
    const root = await tree({ ".gitignore": "dist/\n", "dist/bundle.js": "x" });
    const text = run(["explain", "dist/bundle.js"], root);
    expect(text.code).toBe(0);
    expect(text.stdout).toContain("status: ignored");

    const json = run(["explain", "dist/bundle.js", "--json"], root);
    expect(json.code).toBe(0);
    const parsed = JSON.parse(json.stdout) as {
      path: string;
      ignored: boolean;
      source: string;
      line: number;
      pattern: string;
    };
    expect(parsed.path).toBe("dist/bundle.js");
    expect(parsed.ignored).toBe(true);
    expect(parsed.source).toBe(".gitignore");
    expect(parsed.line).toBe(1);
    expect(parsed.pattern).toBe("dist");
  });

  it("lists rules with hit counts", async () => {
    const root = await tree({ ".gitignore": "*.log\n*.tmp\n", "a.log": "x" });
    const result = run(["list"], root);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("*.log");
    expect(result.stdout).toContain("*.tmp");
    expect(result.stdout).toContain("total: 2 rule(s)");
  });

  it("returns exit code 1 from check when a leak-class issue exists", async () => {
    const root = await tree({ ".gitignore": "*.log\n", ".env": "SECRET=1\n" });
    const result = run(["check"], root);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain("MISSING");
  });

  it("writes a .gitignore with init and refuses to clobber without --force", async () => {
    const root = await tree({ "package.json": "{}" });
    const first = run(["init"], root);
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("detected:");
    expect(first.stdout).toContain("package.json");

    const again = run(["init"], root);
    expect(again.code).toBe(2);
    expect(again.stderr).toContain("already exists");

    const forced = run(["init", "--force"], root);
    expect(forced.code).toBe(0);
  });
});
