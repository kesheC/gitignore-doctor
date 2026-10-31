# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/kesheC/gitignore-doctor/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/kesheC/gitignore-doctor/releases/tag/v0.1.0