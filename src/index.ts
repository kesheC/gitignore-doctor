/**
 * Public library API for gitignore-doctor.
 *
 * Everything exported here is pure or filesystem-only: no process.argv
 * parsing, no process.exit, no console output. The CLI lives in cli.ts.
 */
export { parseIgnoreFile, stripTrailingSpaces, describeRule } from "./rules.js";
export {
  globToRegExpSource,
  matchPath,
  ruleMatches,
  toPosix,
  segments,
  relativeWithin,
} from "./matcher.js";
export {
  explainPath,
  findRepoRoot,
  collectIgnoreFiles,
  flattenRules,
  normalizeTarget,
  formatRule,
  discoverIgnoreFiles,
} from "./resolve.js";
export { checkRepo } from "./check.js";
export { detectStacks, generateIgnoreFile, listStacks, ignoreFileTarget } from "./init.js";
export {
  runGit,
  isGitAvailable,
  isGitRepository,
  listTrackedFiles,
  isTracked,
  gitCheckIgnore,
} from "./git.js";
export type {
  IgnoreRule,
  IgnoreFile,
  ChainStep,
  MatchResult,
  ExplainResult,
  Issue,
  IssueKind,
  CheckOptions,
  CheckReport,
  DetectedStack,
  DetectResult,
} from "./types.js";
