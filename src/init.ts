/**
 * Stack detection and .gitignore generation for `gid init`.
 *
 * Detection is deliberately boring: a fixed list of marker files, each of
 * which is reported as evidence so the user can see why a section appeared.
 */
import { readdir } from "node:fs/promises";
import * as path from "node:path";

import type { DetectedStack, DetectResult } from "./types.js";

interface StackDefinition {
  id: string;
  label: string;
  /** Files or directories whose presence is evidence for this stack. */
  markers: string[];
  /** Lines emitted when the stack is detected. */
  lines: string[];
}

const STACKS: StackDefinition[] = [
  {
    id: "node",
    label: "Node.js / JavaScript",
    markers: ["package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"],
    lines: ["node_modules/", "npm-debug.log*", "yarn-error.log*", ".pnpm-debug.log*", ".npm/", ".node_repl_history"],
  },
  {
    id: "python",
    label: "Python",
    markers: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"],
    lines: [
      "__pycache__/",
      "*.py[cod]",
      "*.egg-info/",
      ".venv/",
      "venv/",
      ".pytest_cache/",
      ".mypy_cache/",
      ".ruff_cache/",
      "build/",
      "dist/",
    ],
  },
  {
    id: "go",
    label: "Go",
    markers: ["go.mod", "go.sum"],
    lines: ["*.exe", "*.test", "*.out", "vendor/"],
  },
  {
    id: "rust",
    label: "Rust",
    markers: ["Cargo.toml", "Cargo.lock"],
    lines: ["target/", "**/*.rs.bk", "*.pdb"],
  },
  {
    id: "java",
    label: "Java / JVM",
    markers: ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "gradlew"],
    lines: ["target/", "build/", "*.class", "*.jar", "*.war", ".gradle/", "gradle-app.setting"],
  },
  {
    id: "macos",
    label: "macOS",
    markers: [".DS_Store", ".Spotlight-V100", ".Trashes", ".fseventsd"],
    lines: [".DS_Store", ".AppleDouble", ".LSOverride", "._*", ".Spotlight-V100", ".Trashes", ".fseventsd"],
  },
  {
    id: "windows",
    label: "Windows",
    markers: ["Thumbs.db", "desktop.ini", "$RECYCLE.BIN"],
    lines: ["Thumbs.db", "Thumbs.db:encryptable", "ehthumbs.db", "Desktop.ini", "$RECYCLE.BIN/", "*.lnk"],
  },
  {
    id: "jetbrains",
    label: "JetBrains IDEs",
    markers: [".idea"],
    lines: [".idea/", "*.iml", "*.iws", "*.ipr", "out/"],
  },
  {
    id: "vscode",
    label: "Visual Studio Code",
    markers: [".vscode"],
    lines: [".vscode/*", "!.vscode/extensions.json", "!.vscode/settings.json", "!.vscode/tasks.json", "!.vscode/launch.json"],
  },
];

/** Sections that are useful in nearly every repository. */
const BASELINE_LINES = [
  "# OS junk",
  ".DS_Store",
  "Thumbs.db",
  "",
  "# Secrets - never commit these",
  ".env",
  ".env.*",
  "!.env.example",
  "*.pem",
  "*.key",
  "*.p12",
  "",
  "# Logs",
  "*.log",
  "logs/",
  "",
  "# Editors",
  ".idea/",
  ".vscode/",
  "*.swp",
  "*~",
];

/** Detect the technology stacks present in `root`. */
export async function detectStacks(root: string): Promise<DetectedStack[]> {
  let entries: string[];
  try {
    entries = await readdir(root);
  } catch {
    entries = [];
  }
  const present = new Set(entries);

  const detected: DetectedStack[] = [];
  for (const stack of STACKS) {
    const evidence = stack.markers.filter((marker) => present.has(marker));
    if (evidence.length === 0) continue;
    detected.push({ id: stack.id, label: stack.label, evidence });
  }
  return detected;
}

/** Build a grouped .gitignore body for the detected stacks. */
export async function generateIgnoreFile(root: string, options: { detect?: boolean } = {}): Promise<DetectResult> {
  const stacks = options.detect === false ? [] : await detectStacks(root);
  const blocks: string[] = [];

  blocks.push(BASELINE_LINES.join("\n"));

  for (const stack of stacks) {
    const definition = STACKS.find((candidate) => candidate.id === stack.id);
    if (!definition) continue;
    blocks.push("# " + definition.label + " (detected: " + stack.evidence.join(", ") + ")\n" + definition.lines.join("\n"));
  }

  return { stacks, content: blocks.join("\n\n") + "\n" };
}

/** The stack catalogue, exposed for docs and tests. */
export function listStacks(): Array<{ id: string; label: string; markers: string[] }> {
  return STACKS.map((stack) => ({ id: stack.id, label: stack.label, markers: [...stack.markers] }));
}

/** Resolve the output path for `gid init`. */
export function ignoreFileTarget(root: string): string {
  return path.join(root, ".gitignore");
}
