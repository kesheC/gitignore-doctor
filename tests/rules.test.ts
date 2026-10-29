import { describe, expect, it } from "vitest";

import { parseIgnoreFile, stripTrailingSpaces, describeRule } from "../src/rules.js";

function parse(body: string) {
  return parseIgnoreFile(body, { source: ".gitignore", sourceAbs: "/repo/.gitignore", baseDir: "" });
}

describe("parseIgnoreFile", () => {
  it("skips blank lines and comments but keeps escaped #", () => {
    const rules = parse(["", "# a comment", "#!another", "\\#literal", "keep.txt"].join("\n"));
    expect(rules.map((rule) => rule.pattern)).toEqual(["#literal", "keep.txt"]);
    expect(rules.map((rule) => rule.line)).toEqual([4, 5]);
  });

  it("records one-based line numbers including skipped lines", () => {
    const rules = parse(["# header", "*.log", "", "!/keep.log"].join("\n"));
    expect(rules).toHaveLength(2);
    expect(rules[0]?.line).toBe(2);
    expect(rules[1]?.line).toBe(4);
    expect(rules[1]?.negated).toBe(true);
  });

  it("strips trailing spaces unless they are escaped", () => {
    expect(stripTrailingSpaces("a.txt   ")).toBe("a.txt");
    expect(stripTrailingSpaces("a.txt\\ ")).toBe("a.txt\\ ");
    expect(stripTrailingSpaces("plain")).toBe("plain");
  });

  it("treats a trailing slash as directory-only and drops it from the pattern", () => {
    const rules = parse("build/");
    expect(rules[0]?.dirOnly).toBe(true);
    expect(rules[0]?.pattern).toBe("build");
  });

  it("marks leading-slash and slash-containing patterns as anchored", () => {
    const anchored = parse(["/root.txt", "a/b.txt"].join("\n"));
    expect(anchored[0]?.anchored).toBe(true);
    expect(anchored[0]?.pattern).toBe("root.txt");
    expect(anchored[1]?.anchored).toBe(true);
    const loose = parse("*.log");
    expect(loose[0]?.anchored).toBe(false);
  });

  it("handles CRLF input identically to LF", () => {
    const crlf = parse("*.log\r\n!keep.log\r\n");
    expect(crlf.map((rule) => rule.pattern)).toEqual(["*.log", "keep.log"]);
    expect(crlf[1]?.negated).toBe(true);
  });

  it("assigns a monotonic evaluation order", () => {
    const rules = parse(["a", "b", "c"].join("\n"));
    expect(rules.map((rule) => rule.order)).toEqual([0, 1, 2]);
  });

  it("describes a rule's shape for humans", () => {
    const rule = parse("!dir/")[0];
    expect(rule).toBeDefined();
    if (!rule) return;
    expect(describeRule(rule)).toContain("negation");
    expect(describeRule(rule)).toContain("directory-only");
  });
});
