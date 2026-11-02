import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

import { checkRepo } from "../src/check.js";
import { parseIgnoreFile } from "../src/rules.js";

// The demo the README quotes is generated, not committed: demo/make-fixture.mjs
// writes the .gitignore and the two files that make one finding of every kind.
// That means the README's three headline numbers (53 lines, 40 rules, 39 dead)
// describe a script, and nothing checked that the script still produces them --
// the exact shape of rot the README warns about. This pins the prose to the
// generator: edit the fixture and the numbers stop matching, loudly.

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const GIT_READY = spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;

const dir = GIT_READY ? mkdtempSync(join(tmpdir(), "gid-readme-")) : "";

afterAll(() => {
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Pull one documented number out of the README, failing if the sentence moved. */
function quoted(pattern: RegExp): number {
  const match = readme.match(pattern);
  if (match === null || match[1] === undefined) {
    throw new Error(`README no longer states a count for ${pattern}`);
  }
  return Number(match[1]);
}

describe.skipIf(!GIT_READY)("README demo numbers", () => {
  it("match the fixture the demo script generates", async () => {
    execFileSync(process.execPath, ["demo/make-fixture.mjs", "--dir", dir], { cwd: root, stdio: "pipe" });

    const ignoreFile = readFileSync(join(dir, ".gitignore"), "utf8");
    const lines = ignoreFile.replace(/\n+$/, "").split("\n").length;
    const rules = parseIgnoreFile(ignoreFile, { source: ".gitignore" });
    const report = await checkRepo(dir);
    const dead = report.counts.DEAD;

    // "a real 53-line .gitignore" / "针对一份 53 行的真实 .gitignore"
    expect(quoted(/a real (\d+)-line `\.gitignore`/)).toBe(lines);
    expect(quoted(/针对一份 (\d+) 行的真实 `\.gitignore`/)).toBe(lines);

    // "The fixture has 40 rules and gid list prints all of them"
    expect(quoted(/The fixture has (\d+) rules/)).toBe(rules.length);

    // Only trace.log matches a rule, so every other rule is dead: the three
    // sentences below all quote that same remainder.
    expect(rules.length - dead).toBe(1);
    expect(quoted(/the real run printed (\d+) of them/)).toBe(dead);
    expect(quoted(/matches a rule, so (\d+) rules/)).toBe(dead);
    expect(quoted(/实际打印了 (\d+) 条 DEAD/)).toBe(dead);
    expect(quoted(/另外 (\d+) 条都是 0 命中/)).toBe(dead);
  });
});
