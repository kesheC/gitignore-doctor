# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **A pattern V8 refuses to compile is a finding, not a crash.** One
  `.gitignore` line of 40,000 characters sailed through parsing and then threw
  `Invalid regular expression: ... Regular expression too large` during the tree
  walk: `gid check`, `gid explain` and `gid list` all exited 1 with the whole
  pattern printed back at the reader. V8 compiles a regular expression lazily, so
  the failure only shows up on first use; the matcher is now compiled and test-run
  while the rule is parsed, and a pattern that cannot be used becomes an
  `INVALID` finding naming the line, the shortened pattern and the reason. Such a
  rule no longer also reports as `DEAD`, and `--strict` fails on it.
- **Rule text in findings and in `list` is abbreviated.** A pathological line is
  quoted as `xxxx... (40000 characters)` instead of being pasted into every
  DEAD, CONFLICT and INVALID message.

## [0.1.10] - 2026-11-01

### Fixed

- **`--cwd` points at the path it cannot find instead of blaming git.** A
  directory that does not exist produced `gid: not a git repository: <path>`,
  which sends the reader looking at git when the path is the problem; `gid list`
  was worse and printed `No ignore rules found` with exit 0. The three cases are
  now told apart: `no such directory`, `not a directory`, and -- only when the
  directory is real -- `not a git repository`.
- **`--` ends option parsing, so a path that starts with a dash can be
  explained.** `gid explain -- --weird-name` was a usage error; the usual escape
  hatch did not exist, so a file named like a flag could not be passed at all.
- **`--flag=value` is accepted, so `--cwd=.` no longer reads as an unknown
  option.** `gid list --cwd=.` answered `unknown option for 'gid list':
  --cwd=.`; the parser only knew the two-token spelling. A boolean given a
  value (`--why=1`) is now a usage error rather than being accepted and ignored.

### Quality

- 98 tests across 10 spec files, 2,195 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20 and 22.
- Zero runtime dependencies.

## [0.1.9] - 2026-11-01

### Added

- **The Chinese half of the README is complete.** The problem section had an
  English body under a bare `## 中文说明` heading; it now says what the tool is
  for, quotes the real 39 DEAD rules the tool prints, and repeats the warning
  not to install from `git+https://`. 1,472 CJK characters, up from 1,426.

### Fixed

- **The 0.1.8 notes now match what changed.** The "three guards" bullet claimed
  guards v0.1.7 already had; only the `dist/` clear was new. Version headings
  had no link definitions, so `[0.1.7]` and `[0.1.8]` rendered as literal text,
  and `[Unreleased]` still compared against v0.1.6.

### Quality

- 92 tests across 10 spec files, 2,147 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20 and 22.
- Zero runtime dependencies.

## [0.1.8] - 2026-11-01

### Added

- **The release gates are executed, not spell-checked.** `tests/workflow.test.ts`
  used to assert that certain strings appeared in `release.yml` and `ci.yml`.
  Each guard's own shell body is now cut out of the workflow and run against
  throwaway fixtures -- the tag gate against matching, drifted, non-semver and
  prerelease tags; the package-contents assertion against a complete manifest,
  a stray `.js.map`, an empty `dist/` and a leaked `src/`. 21 cases, up from 7.
- **One guard the old test did not have: `dist/` is cleared.** `npm run clean`
  existed at v0.1.7 but nothing asserted it, so deleting the line from
  `package.json` would have gone green. The test now checks that `build` chains
  `npm run clean` and that `clean` actually removes `dist/`.

## [0.1.7] - 2026-11-01

### Fixed

- **`.git/info/exclude` now anchors at the repository root.** It was parsed
  with the file's own directory as the anchor, so every rule in it matched
  nothing and `gid` disagreed with `git check-ignore` on the same tree.
- **`core.ignorecase` is honoured.** On Windows and macOS a rule matched
  case-sensitively while git matched case-insensitively, which also made
  `check` report one file as both MISSING and DEAD.
- **`--global` contributes rules again.** It passed an absolute path where a
  repo-relative one was expected, so the global excludes file added nothing.
- **`check` no longer tells you to delete defensive rules.** A rule that has
  not matched yet is usually waiting for an accident, not dead; the advice now
  says so, and `--verbose` restores the blunt wording for rules that really
  did move.
- **A negation under an excluded directory is a `CONFLICT`.** `explain` already
  warned about it; `check` stayed silent.
- **`check` and `init` exit 2 outside a git work tree** instead of printing
  'No issues found' or writing a `.gitignore` next to nothing.
- **Unknown and misspelled options exit 2** for every subcommand.
- **The `--all` truncation wording matches the output.** Help claimed 'first 8
  per kind' while the command printed eight findings followed by an 'and N
  more' line; both the flag description and the README now describe what
  happens, pinned by a test.

### Changed

- The `node` template in `init` covers `dist/`, `build/`, `coverage/`,
  `*.tsbuildinfo` and `.eslintcache`.
- The README demo, list and limits sections quote the output of the fixed
  binary, and document exit code 2 plus the case-insensitivity and
  global-excludes rules.

### Quality

- `tests/regressions.test.ts` pins the ignore behaviour against
  `git check-ignore -q` as the oracle; against the previous tree, 9 of its 14
  cases fail.

## [0.1.6] - 2026-11-01

### Fixed

- **The README claimed the npm name was taken.** It said the `gitignore-doctor` name on npm belonged to an unrelated package. It does not: `npm view gitignore-doctor` returns 404, the name is unregistered. The README now says this project has no publishing credentials yet, instead of blaming a squatter.

## [0.1.5] - 2026-11-01

### Changed

- **The release page now explains the release.** The workflow used to publish a body containing only a compare link, so the one page a prospective user lands on said nothing about what changed. The body is now the `CHANGELOG.md` section for the tag, and a tag with no written section fails the job instead of shipping an empty release.

## [0.1.4] - 2026-11-01

### Changed

- The install section documents the `gitignore-doctor.tgz.sha256` checksum every release publishes, so a download can be verified before it is executed.

## [0.1.3] - 2026-11-01

### Fixed

- **The CLI exited silently when started from an npm bin link.** The entry
  guard compared `process.argv[1]` with `import.meta.url` as raw strings. Node
  resolves `import.meta.url` to the real path but leaves `argv[1]` as written,
  so whenever the binary was reached through a link the guard was false, `main`
  never ran, and the process exited 0 having printed nothing. Every invocation
  is compared through `realpathSync` on both sides now, with a regression test
  that runs the built binary through a link and a CI step that asserts the
  printed version instead of only the exit code.

## [0.1.2] - 2026-11-01

### Changed

- **CI runs every Node version the package claims to support.** The matrix was
  Node 20 and 22; it is now 20, 22 and 24. The floor still matches `engines`,
  and 24 is the current active LTS.
- **CI now installs the packed tarball and runs the binary from it.** Tests
  prove the source compiles; this proves the thing users download works.
- GitHub Actions moved from `checkout@v4` / `setup-node@v4` to `v5`, which runs
  on Node 24 and clears the Node 20 deprecation warning on every job.
- The README install commands point at
  `releases/latest/download/NAME.tgz` instead of a version-pinned URL, so the
  documented command keeps working across releases. Each release now uploads a
  stable-named copy next to the versioned tarball.

### Fixed

- **`npm run typecheck` failed on a clean checkout.** `tsconfig.json` declared
  `rootDir: src` while including `tests`, so tsc rejected every test file with
  `TS6059: not under rootDir`. The emit paths now live only in
  `tsconfig.build.json`, which is where they matter.

## [0.1.1] - 2026-10-31

### Fixed

- **Install instructions that could not work.** The README told you to run
  `npm install -g github:kesheC/gitignore-doctor`, which resolves to an SSH URL, and in
  the case of `gitignore-doctor` also implied an npm registry package that does not exist.
  Both paths are gone. The documented install path is now the release tarball,
  which is built, smoke-tested and uploaded by CI on every tag.

### Added

- `.github/workflows/release.yml`: on a `v*` tag, build, test, `npm pack`, install
  the resulting tarball in a clean directory, run the packaged binary, then upload
  the tarball and its `.sha256` to the GitHub Release.
- `SECURITY.md` with a supported-versions table, a private reporting channel and an
  explicit in-scope / out-of-scope list.
- `prepack` script, so `npm pack` always ships a freshly built `dist/`.
- `author`, `bugs` and `homepage` fields in `package.json`.

### Changed

- `engines.node` is now `>=20.11` for every release artefact, matching the oldest
  Node version the test matrix exercises.
- The build hook moved from `prepare` to `prepack`. `prepare` ran on every
  consumer's machine during install — where `devDependencies` are absent — and npm
  11 warns loudly about unreviewed install scripts, so the documented install path
  printed a warning for no benefit. The tarball now ships a prebuilt `dist/`.

### Removed

- npm registry badges and `npm install -D gitignore-doctor` snippets that pointed at an
  unrelated (or non-existent) registry package.

## [0.1.0] - 2026-10-29

### Added

- Initial release: Explain and audit .gitignore rules: why a path is ignored, which file and line did it, and what is silently leaking into your repo.

- `gid explain <path>` names the exact `.gitignore` file and line that decides whether a path is ignored.
- `gid check` audits the repository for files that are ignored but should be committed, and files that are committed but should be ignored.
- `gid list` prints the effective rule set in evaluation order, including `$HOME` and `core.excludesFile` rules.
- `gid init` scaffolds a project-appropriate `.gitignore`.
- `--global`, `--strict`, `--all` and `--why` control the scope and the depth of the explanation.
- Zero runtime dependencies; the gitignore matching engine is implemented in-tree.

### Quality

- 50 tests across 6 spec files, 1847 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20 and 22.
- Zero runtime dependencies.

[Unreleased]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.10...HEAD
[0.1.10]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kesheC/gitignore-doctor/releases/tag/v0.1.0