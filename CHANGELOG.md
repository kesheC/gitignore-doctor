# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.22] - 2026-11-02

### Added

- **Coverage is measured, gated, and green — the suite had never been run under a
  coverage provider before, so every coverage claim in this repository was unverifiable.**
  `@vitest/coverage-v8` is now a dev dependency and `npm run coverage` runs the same
  suite under v8. The config excludes `dist/**`: every spec imports the built output, so
  without that exclusion each module is counted twice — once through its source map and
  once as the emitted `dist` file — which halves the number. Measured on the sibling
  `repropack`, the same suite read 46.75% with `dist` counted and 89.66% without it.
  Floor numbers for the tree today: 81.5% statements, 71.23% branches, 92.2% functions, 85.56% lines.

### Changed

- **TypeScript 5.9.3 → 7.0.2.** This was declined in `dependabot.yml` when the major
  first appeared, because TS 7 stopped pulling `@types/node` in implicitly and every
  build failed on `Cannot find name 'process'`. The fix turned out to be one line —
  `"types": ["node"]` in the base tsconfig — so TS 7 is adopted, TypeScript is no longer
  in the ignore list, `vitest` and `@types/node` still are. The comment in
  `dependabot.yml` records what the ignore is waiting for: an ignore with no stated exit
  condition silently swallows a whole track of upgrades long after the reason expired.

### Quality

- 115 tests across 12 spec files, 2397 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Coverage: one leg only, Linux on Node 24, so the numbers stay comparable between runs.

## [0.1.21] - 2026-11-02

### Security

- **The workflows pinned third-party actions by tag, which is a mutable pointer.**
  `actions/checkout@v5` means whatever the action's maintainers push to that tag, so a
  moved tag silently swaps the code this repository's own token runs — and CI would stay
  green throughout. Both actions are now pinned to a commit sha with the readable version
  kept beside them (`# v7.0.1`, `# v7.1.0`), and `tests/workflow.test.ts` fails when a
  `uses:` line carries a tag instead of a 40-character sha, or a sha without its comment.
  Dependabot bumps the two halves together, so the comment cannot drift away from the sha.

### Added

- `.github/dependabot.yml` covers the two ecosystems this repository actually installs:
  the workflow actions and the dev toolchain in `package-lock.json`. Weekly, grouped, so a
  bump arrives as one pull request with a green run behind it rather than a queue of them.
  Dependabot alerts and automated security fixes were already on; without a version-update
  config, a pinned sha would only ever move when someone remembered to move it.
- The dev toolchain's two major-version bumps are now explicitly declined rather than
  silently pending: `vitest` 5 requires Node ^22.12 and this package still promises
  20.11, so adopting it would either drop the floor or ship a matrix column that cannot
  install the toolchain; `@types/node` majors describe a runtime newer than the floor.
  `dependabot.yml` ignores those two majors only — minors and patches still arrive, and
  **security updates are not filtered by `ignore`**, so an advisory on either one still
  opens a pull request.

### Quality

- 114 tests across 12 spec files, 2397 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.20] - 2026-11-02

### Fixed

- **CONTRIBUTING.md promised "the same three commands CI runs" and listed three, while CI ran
  four.** The sentence is a claim about the workflow, and it went stale the moment the audit
  step landed: a contributor following the list would have skipped the one check that reads
  the whole supply chain. The heading is now "the commands CI runs" without a count, the list
  includes `npm audit --audit-level=high`, and `tests/workflow.test.ts` walks all four names
  through both files so a step added to one without the other fails the suite instead of the
  reader.
- **`package-lock.json` was marked `-diff`, so its diff was never readable.** The attribute
  reads like "also treat this as text" and means the opposite: `diff` set to *unset*, do not
  diff this file. Every dependency change therefore rendered as `Binary files differ` with zero
  lines to review, and the only way to see which packages moved was to open the lockfile and
  read it by hand. The lockfile is the one file a reviewer actually reads on a dependency bump,
  so this was backwards. The attribute is now `text eol=lf`, and `tests/package.test.ts` asks
  git (`git check-attr diff -- package-lock.json`) rather than inspecting the file, because
  `-diff`, `diff=false` and `binary` all spell differently and end in the same place.

### Security

- **The test toolchain was carrying six advisories, two of them critical.** `npm audit`
  reported `3 moderate, 1 high, 2 critical` on every repository in this set. All six came in
  through `vitest 2.1.9`: `tinypool <=2.1.1` (prototype-pollution gadget reaching RCE, twice),
  `@vitest/mocker <=4.1.11` (path traversal, manual-mock code injection) and the `vite`/`esbuild`
  dev-server request forwarding. The package itself ships zero runtime dependencies, so this
  was never a user-facing hole — but a contributor's machine runs all of it on `npm test`.
  `vitest` is now `^4.1.12`, which resolves the tree to vite 8 and reports `0 vulnerabilities`.

  The fix exposed a second thing the gates could not see: **vitest 4 pulls in vite 8, whose
  `engines` is `^20.19.0 || >=22.12.0`, one minor above the 20.11 floor the shipped CLI still
  promises.** Those are two different promises — what the tool runs on versus what the test
  runner runs on — so the floor stays at 20.11 and `CONTRIBUTING.md` now says plainly that
  working on the code needs a newer 20.x than using it does. CI's `node: 20` column resolves to
  the latest 20.x, so it sits above that line.

### Added

- **`npm audit --audit-level=high` is now a CI step**, placed after `npm ci` so it inspects the
  installed tree rather than an empty one. Moderate and low advisories are not gate failures;
  they get read on the next dependency bump instead of blocking an unrelated fix.

- **Two guards keep the promise honest.** One fails when the audit step disappears or is
  reordered before the install; the other fails when `engines.node` and the oldest matrix
  column disagree — a floor above the matrix is a version nobody runs, a floor below it is a
  version never promised. Moving either number alone now breaks `tests/workflow.test.ts`.

### Quality

- 113 tests across 12 spec files, 2397 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.


## [0.1.19] - 2026-11-02

### Fixed

- **A bare `tsc` wrote its output next to the sources.** `npm run typecheck` passes `--noEmit`,
  but the editor and anyone typing `npx tsc` obey `tsconfig.json` alone. Without `noEmit` there,
  a full compile dropped .js, .d.ts and .js.map beside every .ts — 69 untracked files in this
  repository the first time it was measured — which the next `git add .` would have swept into a
  commit. `noEmit` now lives in the base config, so emitting is something the build config has to
  ask for explicitly rather than a thing you forget to turn off.

- **The tsconfig split is now pinned by tests.** `tests/package.test.ts` gained two cases: the
  base config must set `noEmit` and carry no `outDir`, and the build config must restate
  `noEmit: false` with `rootDir` and `include: ["src"]`. Both were true before only by accident of
  whichever file was edited last.

### Quality

- 109 tests across 12 spec files, 2397 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.17] - 2026-11-02

### Fixed

- **`npm run dev` could not start, in any of the six repositories.** The script was
  `node --experimental-strip-types src/cli.ts`, which never worked here: every source file imports its
  siblings with a `.js` suffix, because that is what `moduleResolution: NodeNext` requires for the
  compiled output to resolve, and the type-stripping loader does not map `./errors.js` back to
  `./errors.ts`. It exited 1 with `ERR_MODULE_NOT_FOUND` before printing a line of the program.
- The script now builds first and runs the build: `npm run build && node dist/cli.js`.
  The build takes under two seconds, and a development entry point that cannot start is worse than
  no entry point at all.

### Quality

- 107 tests across 12 spec files, 2397 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.15] - 2026-11-02

### Fixed

- **The README's demo numbers had nothing watching them.** "a real 53-line `.gitignore`",
  "The fixture has 40 rules" and the three sentences quoting "39" all describe
  `demo/make-fixture.mjs`, not a committed file, so editing the fixture would have left every
  quoted number describing a tree that no longer exists while every gate stayed green — the
  exact rot `gid` exists to find. `tests/demo.test.ts` now generates the fixture, parses its
  `.gitignore`, runs `checkRepo` over it and asserts all seven documented numbers (the English
  and Chinese line count, the rule count and the four dead-rule counts) against that run.
- **The contributing guide still said the README transcripts are not re-run by CI.** That
  stopped being true when `tests/demo.test.ts` landed: it runs `demo/make-fixture.mjs`, parses
  the generated `.gitignore` and asserts the seven numbers the demo paragraphs quote. The guide
  now says which blocks are under test and which were checked by hand.

### Quality

- 107 tests across 12 spec files, 2397 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.


## [0.1.14] - 2026-11-02

### Added

- **The files GitHub looks for on a healthy repository.** The repository had issue templates and
  workflows but no `CONTRIBUTING.md`, no `CODE_OF_CONDUCT.md` and no pull request template, so
  the community profile counted it as incomplete and a first-time contributor had to guess at the
  house rules. `CONTRIBUTING.md` writes down what the code actually depends on — zero runtime
  dependencies, ESM with NodeNext and `.js` import suffixes, strict TypeScript including
  `noUncheckedIndexedAccess`, stdout for machine output and stderr for human output, Node >= 20.11
  — plus the three local gates CI runs. `CODE_OF_CONDUCT.md` is Contributor Covenant 2.1 with
  reporting pointed at the private advisory channel. The pull request template asks for the command
  and its output, because "tests pass" only shows that nothing already covered broke.

### Fixed

- **The lockfile still described 0.1.0 with an engines floor of `>=20`.** It was last written
  before the version bumps, and nothing in CI reads it closely enough to fail, so a stale lock
  could have sat there indefinitely. Regenerating it against the current manifest brings the
  version, the root package entry and `engines.node` back in line.
- **The bug report template offered a version from nine releases ago.** It asked for `0.1.1` as
  the example version and pinned the install field to `.../download/v0.1.1/....tgz`. Both still
  resolve, so nothing was broken — but anyone filling the form in copies a stale shape and the
  report arrives describing a version nobody runs. The install placeholder now uses
  `releases/latest/download/`, which keeps working as releases move on.
- **The channel picker had no route to the one report that must not be public.** `config.yml` had
  `contact_links: []`; it now carries a link to the private security advisory page.
- **`CONTRIBUTING.md` was reachable only from the file list.** The security paragraph at the end
  of the README now points at it, in the same bilingual shape that paragraph already uses.

- **`CONTRIBUTING.md` promised a CI gate that does not exist here.** It said that a change
  touching a README transcript gets that transcript re-run by CI. Two of the six repositories
  have such a step; this one does not, so a contributor would have updated the README and waited
  for a check that never runs. The paragraph now says the transcripts are verified by hand and
  asks for the exact command and its output instead.

### Quality

- 106 tests across 11 spec files, 2397 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.13] - 2026-11-02

### Changed

- **Every README transcript now runs inside the fixture it needs.** `gid check` at the repository
  root reports a different tree from the generated fixture, and the transcripts quoted the
  fixture. They now print how to build it (`node demo/make-fixture.mjs`), what it wrote, and then
  `cd` into it, so the quoted numbers are the numbers a reader gets.

### Fixed

- **The changelog described a CI matrix that no longer existed.** Every quality note from 0.1.2
  onwards said "Node 20 and 22", but the matrix has run 20, 22 and 24 since that release — so each
  of those sections, and the GitHub release notes generated from them, named a matrix the project
  had already outgrown. The notes now list the versions CI actually runs.

### Quality

- 106 tests across 11 spec files, 2397 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.12] - 2026-11-02

### Fixed

- **A closed pipe is an ending, not a crash.** `gid list | head -5` printed its
  first lines and then died with `Error: write EPIPE` and exit 1: the reader
  had what it wanted, Node raised an error event on stdout, and nothing was
  listening, so a finished run looked like a failed one. stdout now reads a
  closed pipe as "the reader is done" and exits 0; stderr carries only
  progress and warnings, so an EPIPE there is swallowed and the command runs
  to the end. Any other stream error is still thrown.

### Quality

- 106 tests across 11 spec files, 2397 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

## [0.1.11] - 2026-11-01

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
- **A misspelled flag is reported even when `--help` is also on the line.**
  The help branch ran before the per-command option check, so `gid list --stict`
  printed the help text and exited 0, and `gid --bogus` printed help on stdout
  while exiting 2 -- the one combination a script cannot read. Options are now
  validated first: `gid list --stict` exits 2 with
  `gid: unknown option for 'gid list': --stict`.
- **`--version` is a top-level request, not a per-command flag.** `gid check
  --version` used to print the version and exit 0; it now exits 2 with
  `--version is not supported by 'gid check'; it applies to "gid --version" on its
  own`, which is what the other commands in this family say.
- **A failure is a document too, not just a sentence.** `gid check --json --cwd
  /missing` answered `{"error": "no such directory: ..."}`, every other failure
  path wrote nothing to stdout at all, and `gid nosuchcommand --json` blamed
  `--json` instead of the command. Every failure path now emits
  `{"error":{"message":...,"exitCode":n}}`, the same shape as the rest of this
  set, and an unknown command is answered before its options. Without `--json`
  stdout stays empty.

### Quality

- 104 tests across 10 spec files, 2364 lines of TypeScript.
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
- Zero runtime dependencies.

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
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
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
- CI matrix: Ubuntu and Windows, Node 20, 22 and 24.
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

[0.1.11]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.10...v0.1.11
[0.1.12]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.11...v0.1.12
[0.1.13]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.12...v0.1.13
[0.1.14]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.13...v0.1.14
[0.1.15]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.14...v0.1.15
[0.1.17]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.15...v0.1.17
[0.1.19]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.17...v0.1.19
[0.1.20]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.19...v0.1.20
[0.1.21]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.20...v0.1.21
[0.1.22]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.21...v0.1.22
[Unreleased]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.22...HEAD
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