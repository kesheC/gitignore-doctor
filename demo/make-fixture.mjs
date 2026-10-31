#!/usr/bin/env node
/**
 * Build the throwaway repository the README demo runs against.
 *
 * The point is reproducibility: the .gitignore in here is a verbatim copy of a
 * real 53-line file, trace.log is tracked even though "*.log" matches it, and
 * .env is sitting there unignored. That gives one finding of every blocking
 * kind - plus a pile of dead rules - which is exactly what the demo output
 * shows.
 *
 * The fixture goes to the OS temp directory by default, never inside this
 * repository: gid walks up to find the git root, and running the demo inside a
 * checkout would report on the checkout instead of the fixture.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

/** The 53-line file the README quotes, byte for byte. */
const GITIGNORE = [
  "# ---- DSH / agent 本地状态（不进库）----",
  ".dsh-meow/",
  ".dsh-mattskillsdeck-cache/",
  ".dsh-pocket/",
  ".dsh/",
  "*.db-shm",
  "*.db-wal",
  "",
  "# ---- 子项目（各自是独立 git 仓库）----",
  "projects/*/",
  "",
  "# ---- 系统垃圾 ----",
  "Thumbs.db",
  "Desktop.ini",
  ".DS_Store",
  "ehthumbs.db",
  "$RECYCLE.BIN/",
  "",
  "# ---- 编辑器 ----",
  ".vscode/",
  ".idea/",
  "*.swp",
  "*.swo",
  "",
  "# ---- Python ----",
  "__pycache__/",
  "*.py[cod]",
  "*.egg-info/",
  ".venv/",
  "venv/",
  "env/",
  "build/",
  "dist/",
  ".pytest_cache/",
  ".mypy_cache/",
  ".ruff_cache/",
  ".ipynb_checkpoints/",
  "",
  "# ---- Node ----",
  "node_modules/",
  ".pnpm-store/",
  "npm-debug.log*",
  "yarn-error.log*",
  ".npm/",
  "",
  "# ---- 构建产物 / 临时 ----",
  "*.log",
  "tmp/",
  "temp/",
  "*.tmp",
  "*.bak",
  "*.orig",
  "*~",
].join("\n");

function flag(name, fallback) {
  const index = process.argv.indexOf("--" + name);
  if (index === -1) return fallback;
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith("--") ? fallback : value;
}

const dir = path.resolve(flag("dir", path.join(tmpdir(), "gid-demo")));

if (process.argv.includes("--clean")) {
  rmSync(dir, { recursive: true, force: true });
  console.log("removed " + dir);
  process.exit(0);
}

rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

writeFileSync(path.join(dir, ".gitignore"), GITIGNORE + "\n");

// A tracked file that the .gitignore says to ignore. --force is required
// because git would otherwise refuse to add it.
writeFileSync(path.join(dir, "trace.log"), "2026-10-31T10:00:00Z boot ok\n");
writeFileSync(path.join(dir, ".env"), "DATABASE_URL=postgres://localhost/app\n");

const git = (...args) =>
  execFileSync("git", args, { cwd: dir, stdio: "ignore", env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1" } });

git("init", "-q", "-b", "main");
git("config", "user.email", "demo@example.invalid");
git("config", "user.name", "demo");
git("add", ".gitignore");
git("add", "--force", "trace.log");
git("commit", "-q", "-m", "demo fixture");

console.log("wrote " + dir + " (1 tracked file that should be ignored, 1 unignored .env)");
console.log("");
console.log("  node demo/make-fixture.mjs && gid check --cwd " + JSON.stringify(dir));
console.log("");
console.log("Clean up with: node demo/make-fixture.mjs --clean");
