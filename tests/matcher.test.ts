import { describe, expect, it } from "vitest";

import { parseIgnoreFile } from "../src/rules.js";
import { matchPath } from "../src/matcher.js";

/** Parse a single root-level .gitignore body into an ordered rule list. */
function rulesOf(body: string) {
  return parseIgnoreFile(body, { source: ".gitignore", sourceAbs: "/repo/.gitignore", baseDir: "" });
}

function isIgnored(body: string, candidate: string, isDir = false): boolean {
  return matchPath(rulesOf(body), candidate, isDir).ignored;
}

describe("gitignore glob semantics", () => {
  it("matches a bare pattern at any depth", () => {
    expect(isIgnored("*.log", "a.log")).toBe(true);
    expect(isIgnored("*.log", "deep/nested/b.log")).toBe(true);
    expect(isIgnored("*.log", "a.txt")).toBe(false);
  });

  it("anchors patterns that contain a slash", () => {
    expect(isIgnored("dist/bundle.js", "dist/bundle.js")).toBe(true);
    expect(isIgnored("dist/bundle.js", "sub/dist/bundle.js")).toBe(false);
    // A leading slash is also anchoring, and the slash itself is not matched.
    expect(isIgnored("/top.txt", "top.txt")).toBe(true);
    expect(isIgnored("/top.txt", "nested/top.txt")).toBe(false);
  });

  it("treats a trailing slash as directory-only", () => {
    expect(isIgnored("build/", "build", true)).toBe(true);
    expect(isIgnored("build/", "build", false)).toBe(false);
  });

  it("keeps '*' inside one path segment", () => {
    expect(isIgnored("a*c", "abc")).toBe(true);
    expect(isIgnored("a*c", "a/c")).toBe(false);
  });

  it("supports '?' for a single character", () => {
    expect(isIgnored("file?.txt", "file1.txt")).toBe(true);
    expect(isIgnored("file?.txt", "file12.txt")).toBe(false);
  });

  it("supports bracket ranges and bracket negation", () => {
    expect(isIgnored("file[0-9].txt", "file7.txt")).toBe(true);
    expect(isIgnored("file[0-9].txt", "filex.txt")).toBe(false);
    expect(isIgnored("file[!0-9].txt", "filex.txt")).toBe(true);
    expect(isIgnored("file[!0-9].txt", "file7.txt")).toBe(false);
  });

  it("implements '**/' as zero or more directories", () => {
    expect(isIgnored("**/node_modules", "node_modules", true)).toBe(true);
    expect(isIgnored("**/node_modules", "packages/app/node_modules", true)).toBe(true);
  });

  it("implements a trailing '/**' as everything below", () => {
    expect(isIgnored("dist/**", "dist/a.js")).toBe(true);
    expect(isIgnored("dist/**", "dist/sub/deep/a.js")).toBe(true);
    expect(isIgnored("dist/**", "distfile.js")).toBe(false);
  });

  it("implements a middle '/**/' as zero or more directories", () => {
    expect(isIgnored("a/**/b", "a/b")).toBe(true);
    expect(isIgnored("a/**/b", "a/x/b")).toBe(true);
    expect(isIgnored("a/**/b", "a/x/y/b")).toBe(true);
  });

  it("lets the last matching rule win, not the first", () => {
    const body = ["*.log", "!keep.log"].join("\n");
    expect(isIgnored(body, "keep.log")).toBe(false);
    expect(isIgnored(body, "other.log")).toBe(true);

    const reversed = ["!keep.log", "*.log"].join("\n");
    expect(isIgnored(reversed, "keep.log")).toBe(true);
  });

  it("cannot re-include a file inside an excluded directory", () => {
    const body = ["logs/", "!logs/keep.log"].join("\n");
    const result = matchPath(rulesOf(body), "logs/keep.log", false);
    expect(result.ignored).toBe(true);
    expect(result.viaAncestor).toBe(true);
    expect(result.matchedPath).toBe("logs");
  });
});
