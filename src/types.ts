/** Shared types for gitignore-doctor. */

/** One parsed line of an ignore file. */
export interface IgnoreRule {
  /** The original line as written (after trimming), including any '!' prefix. */
  raw: string;
  /** The matchable pattern: no '!' prefix, no trailing '/', no leading '/'. */
  pattern: string;
  /** True when the rule starts with '!' and re-includes instead of excluding. */
  negated: boolean;
  /** True when the rule ended with '/' and therefore only matches directories. */
  dirOnly: boolean;
  /** True when the rule is relative to the directory that owns the ignore file. */
  anchored: boolean;
  /** POSIX path of the ignore file relative to the repo root, e.g. ".gitignore" or "src/.gitignore". */
  source: string;
  /** Absolute path of the ignore file on disk. */
  sourceAbs: string;
  /** 1-based line number inside the ignore file. */
  line: number;
  /** Directory the ignore file lives in, POSIX relative to the repo root ("" = root). */
  baseDir: string;
  /** Compiled matcher for the pattern, already anchored with ^ and $. */
  regex: RegExp;
  /** Global evaluation order: shallower files first, then line order. */
  order: number;
}

/** One ignore file discovered on the way from the repo root to a target path. */
export interface IgnoreFile {
  /** POSIX path relative to the repo root. */
  source: string;
  /** Absolute path on disk. */
  sourceAbs: string;
  /** Directory the file lives in, POSIX relative to the repo root ("" = root). */
  baseDir: string;
  rules: IgnoreRule[];
}

/** A single step of the decision chain produced by explainPath. */
export interface ChainStep {
  /** Path prefix that was examined (relative to the repo root). */
  path: string;
  /** Whether the prefix was treated as a directory. */
  isDir: boolean;
  /** The winning rule for this prefix, if any. */
  rule: IgnoreRule | null;
  /** What happened at this level. */
  result: "excluded" | "re-included" | "no-match";
}

/** Result of evaluating one path against a set of ignore files. */
export interface MatchResult {
  /** Final verdict. */
  ignored: boolean;
  /** The rule that produced the verdict. */
  rule: IgnoreRule | null;
  /** The prefix that the winning rule matched, which may be an ancestor directory. */
  matchedPath: string | null;
  /** True when the verdict comes from an excluded ancestor directory. */
  viaAncestor: boolean;
  /** The last rule that matched the path itself (used for whitelist reporting). */
  directRule: IgnoreRule | null;
  /** Per-level walk, from the shallowest ancestor down to the path itself. */
  chain: ChainStep[];
}

/** Full explanation for one path. */
export interface ExplainResult extends MatchResult {
  /** Normalized POSIX path relative to the repo root. */
  path: string;
  /** Absolute OS path. */
  absolute: string;
  /** Whether the path currently exists and is a directory. */
  isDir: boolean;
  /** Whether the path exists on disk at all. */
  exists: boolean;
  /** Whether the path is tracked by git (null when git is unavailable). */
  tracked: boolean | null;
  /** Human readable explanation of the verdict. */
  reason: string;
  /** Remediation hint. */
  note: string | null;
  /** The rule that would re-include the path, when one exists. */
  whitelistedBy: IgnoreRule | null;
}

export type IssueKind = "LEAK" | "MISSING" | "DEAD" | "CONFLICT";

/** One finding produced by checkRepo. */
export interface Issue {
  kind: IssueKind;
  /** Higher means more urgent. */
  severity: number;
  /** Path related to the issue, for LEAK and MISSING. */
  path: string | null;
  /** Rule related to the issue, for DEAD and CONFLICT. */
  rule: IgnoreRule | null;
  /** One line summary. */
  message: string;
  /** What the user should do about it. */
  advice: string;
}

/** Options accepted by checkRepo. */
export interface CheckOptions {
  /** Also count DEAD / CONFLICT as failures. */
  strict?: boolean;
  /** Hard cap on the number of filesystem entries visited. */
  maxEntries?: number;
}

/** Result of a repository audit. */
export interface CheckReport {
  root: string;
  issues: Issue[];
  counts: Record<IssueKind, number>;
  /** Number of entries visited while walking the working tree. */
  scanned: number;
  /** Number of ignore files read. */
  ignoreFiles: string[];
  /** Whether git was available; LEAK detection needs it. */
  gitAvailable: boolean;
  /** Whether the audit should be treated as a failure by the CLI. */
  failed: boolean;
}

/** A technology stack detected by `gid init --detect`. */
export interface DetectedStack {
  /** Stable id, e.g. "node". */
  id: string;
  /** Human readable label. */
  label: string;
  /** Why it was detected. */
  evidence: string[];
}

/** Result of stack detection. */
export interface DetectResult {
  stacks: DetectedStack[];
  /** .gitignore body generated from the detected stacks. */
  content: string;
}
