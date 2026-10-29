import { describe, expect, it, afterEach } from "vitest";

import { detectStacks, generateIgnoreFile, listStacks, ignoreFileTarget } from "../src/init.js";
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

describe("detectStacks", () => {
  it("detects node from package.json and reports the evidence", async () => {
    const root = await tree({ "package.json": "{}" });
    const stacks = await detectStacks(root);
    const node = stacks.find((stack) => stack.id === "node");
    expect(node).toBeDefined();
    expect(node?.evidence).toContain("package.json");
  });

  it("detects several stacks at once", async () => {
    const root = await tree({
      "package.json": "{}",
      "pyproject.toml": "",
      "go.mod": "module x\n",
      "Cargo.toml": "",
    });
    const ids = (await detectStacks(root)).map((stack) => stack.id);
    expect(ids).toEqual(expect.arrayContaining(["node", "python", "go", "rust"]));
  });

  it("returns nothing for a directory with no markers", async () => {
    const root = await tree({ "README.md": "# hi\n" });
    expect(await detectStacks(root)).toEqual([]);
  });

  it("does not throw when the directory does not exist", async () => {
    expect(await detectStacks(ignoreFileTarget("/nonexistent-gid-root-xyz"))).toEqual([]);
  });
});

describe("generateIgnoreFile", () => {
  it("always emits the baseline secrets and OS rules", async () => {
    const root = await tree({ "README.md": "# hi\n" });
    const result = await generateIgnoreFile(root);
    expect(result.stacks).toEqual([]);
    expect(result.content).toContain(".env");
    expect(result.content).toContain("*.log");
    expect(result.content).toContain(".DS_Store");
  });

  it("adds a detected section and names its evidence", async () => {
    const root = await tree({ "package.json": "{}" });
    const result = await generateIgnoreFile(root);
    expect(result.stacks.map((stack) => stack.id)).toContain("node");
    expect(result.content).toContain("node_modules/");
    expect(result.content).toContain("package.json");
  });

  it("can be asked for the baseline only", async () => {
    const root = await tree({ "package.json": "{}" });
    const result = await generateIgnoreFile(root, { detect: false });
    expect(result.stacks).toEqual([]);
    expect(result.content).not.toContain("node_modules/");
  });

  it("lists the stack catalogue with markers for docs", () => {
    const stacks = listStacks();
    expect(stacks.length).toBeGreaterThanOrEqual(9);
    expect(stacks.every((stack) => stack.markers.length > 0)).toBe(true);
  });
});
