import { describe, expect, it, afterEach } from "vitest";
import * as path from "node:path";

import { explainPath, findRepoRoot, collectIgnoreFiles, flattenRules } from "../src/resolve.js";
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

describe("explainPath across multiple .gitignore levels", () => {
  it("reports the winning rule with source and line", async () => {
    const root = await tree({
      ".gitignore": "# build output\ndist/\n",
      "dist/bundle.js": "x",
    });
    const result = await explainPath("dist/bundle.js", { cwd: root });
    expect(result.ignored).toBe(true);
    expect(result.rule?.source).toBe(".gitignore");
    expect(result.rule?.line).toBe(2);
    expect(result.rule?.raw).toBe("dist/");
    expect(result.viaAncestor).toBe(true);
    expect(result.matchedPath).toBe("dist");
    expect(result.reason).toContain("dist/");
  });

  it("anchors a nested .gitignore to its own directory", async () => {
    const root = await tree({
      ".gitignore": "",
      "packages/app/.gitignore": "/build/\n",
      "packages/app/build/out.js": "x",
      "build/keep.js": "x",
    });
    const inside = await explainPath("packages/app/build/out.js", { cwd: root });
    expect(inside.ignored).toBe(true);
    expect(inside.rule?.source).toBe("packages/app/.gitignore");

    const outside = await explainPath("build/keep.js", { cwd: root });
    expect(outside.ignored).toBe(false);
  });

  it("lets a deeper .gitignore override a root negation", async () => {
    const root = await tree({
      ".gitignore": "*.log\n",
      "sub/.gitignore": "!trace.log\n",
      "sub/trace.log": "x",
      "sub/other.log": "x",
    });
    expect((await explainPath("sub/trace.log", { cwd: root })).ignored).toBe(false);
    expect((await explainPath("sub/other.log", { cwd: root })).ignored).toBe(true);
  });

  it("explains a re-include attempt that cannot win", async () => {
    const root = await tree({
      ".gitignore": ["logs/", "!logs/keep.log"].join("\n"),
      "logs/keep.log": "x",
    });
    const result = await explainPath("logs/keep.log", { cwd: root });
    expect(result.ignored).toBe(true);
    expect(result.viaAncestor).toBe(true);
    expect(result.whitelistedBy?.raw).toBe("!logs/keep.log");
    expect(result.note).toContain("parent directory");
  });

  it("says nothing matched for a plain unignored file", async () => {
    const root = await tree({
      ".gitignore": "*.log\n",
      "src/main.ts": "x",
    });
    const result = await explainPath("src/main.ts", { cwd: root });
    expect(result.ignored).toBe(false);
    expect(result.rule).toBeNull();
    expect(result.reason).toContain("no ignore rule matches");
    expect(result.exists).toBe(true);
  });

  it("marks a non-existent path as such but still explains rules", async () => {
    const root = await tree({ ".gitignore": "tmp/\n" });
    const result = await explainPath("tmp/scratch.db", { cwd: root });
    expect(result.exists).toBe(false);
    expect(result.ignored).toBe(true);
  });
});

describe("repository discovery", () => {
  it("finds the repo root by walking up from a nested directory", async () => {
    const root = await tree({ ".git/HEAD": "ref: refs/heads/main\n", "a/b/c/file.txt": "x" });
    const found = await findRepoRoot(path.join(root, "a", "b", "c"));
    expect(path.resolve(found)).toBe(path.resolve(root));
  });

  it("collects root and nested ignore files in evaluation order", async () => {
    const root = await tree({
      ".gitignore": "*.log\n",
      "sub/.gitignore": "*.tmp\n",
    });
    const files = await collectIgnoreFiles(root, {});
    expect(files.map((file) => file.source)).toEqual([".gitignore", "sub/.gitignore"]);
    const rules = flattenRules(files);
    expect(rules.map((rule) => rule.pattern)).toEqual(["*.log", "*.tmp"]);
    expect(rules[1]?.baseDir).toBe("sub");
  });
});
