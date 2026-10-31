# gid — explain & audit .gitignore rules

**Know exactly why a file is ignored, and what is silently leaking into your repo.**
**搞清楚一个文件为什么被忽略，以及你的仓库里到底混进了什么不该进的东西。**

[![CI](https://github.com/kesheC/gitignore-doctor/actions/workflows/ci.yml/badge.svg)](https://github.com/kesheC/gitignore-doctor/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.11-informational.svg)](https://nodejs.org)
[![Dependencies](https://img.shields.io/badge/runtime%20dependencies-0-success.svg)](./package.json)

---

## The problem

`.gitignore` is the one config file nobody reviews. Rules get copy-pasted between
projects, negations silently lose to earlier directory exclusions, and the worst
failure mode is invisible: **git already tracks the file, so the rule protecting
your `.env` does nothing at all.** `git check-ignore -v` answers one path at a time
and says nothing about dead rules, missing rules, or files already leaked into history.

## Install

`gid` is **not published to the npm registry** — that name belongs to an unrelated
package. Every release ships a tarball you can install directly:

```bash
npm install -g https://github.com/kesheC/gitignore-doctor/releases/download/v0.1.1/gitignore-doctor-0.1.1.tgz
gid --version
```

Or build it from a checkout:

```bash
git clone https://github.com/kesheC/gitignore-doctor.git
cd gitignore-doctor
npm ci && npm run build && npm link
```

Requires Node.js >= 20.11. **Zero runtime dependencies** — everything is Node stdlib.

> `npm install -g git+https://github.com/...` does **not** work on npm 11: a global
> install skips `devDependencies`, so the `prepare` build finds no `tsc`.

## Quick start

```bash
cd your-repo
gid check
```

Real output, run against a copy of a real 53-line `.gitignore` in a temp repo
(DEAD findings truncated — the real run printed 38 of them):

```text
$ gid check
repository: C:\Users\Administrator\AppData\Local\Temp\gid-demo
scanned:    8 entries, 1 ignore file(s)

LEAK - tracked despite being ignored (1)
  [LEAK] trace.log
        trace.log is tracked by git but matches .gitignore:47 "*.log"
        fix: run `git rm --cached "trace.log"` to stop tracking it (the file stays on disk)
MISSING - should be ignored but is not (1)
  [MISSING] .env
        .env looks like an environment file but no ignore rule covers it
        fix: add a rule such as `.env` to .gitignore
DEAD - rules that match nothing (38)
  [DEAD] .gitignore:2
        .gitignore:2 ".dsh-meow/" matches nothing in this repository
        fix: delete the rule, or fix it if the path moved
  [DEAD] .gitignore:3
        .gitignore:3 ".dsh-mattskillsdeck-cache/" matches nothing in this repository
        fix: delete the rule, or fix it if the path moved
  [DEAD] .gitignore:4
        .gitignore:4 ".dsh-pocket/" matches nothing in this repository
        fix: delete the rule, or fix it if the path moved
  [DEAD] .gitignore:5
        .gitignore:5 ".dsh/" matches nothing in this repository
        fix: delete the rule, or fix it if the path moved
  [DEAD] .gitignore:6
        .gitignore:6 "*.db-shm" matches nothing in this repository
        fix: delete the rule, or fix it if the path moved
  [DEAD] .gitignore:7
        .gitignore:7 "*.db-wal" matches nothing in this repository
        fix: delete the rule, or fix it if the path moved
  [DEAD] .gitignore:10
        .gitignore:10 "projects/*/" matches nothing in this repository
        fix: delete the rule, or fix it if the path moved
  [DEAD] .gitignore:13
        .gitignore:13 "Thumbs.db" matches nothing in this repository
        fix: delete the rule, or fix it if the path moved
  ... and 30 more DEAD finding(s); use --all to see them

summary: 1 leak, 1 missing, 38 dead, 0 conflict
result:  FAIL (2 blocking)
```

Exit code was `1`, so this doubles as a pre-commit or CI gate.

## Usage

### `gid explain <path>`

Why is this path ignored? Which file, which line, which rule won?

```bash
gid explain node_modules/left-pad/index.js
```

```text
path:   node_modules/left-pad/index.js
status: ignored
rule:   .gitignore:40  "node_modules/"  (directory-only match on ancestor "node_modules")
chain:  node_modules -> .gitignore#40 (excluded)
git:    untracked
note:   the parent directory 'node_modules' is excluded, so git never looks inside it; re-including a child needs the parent re-included first.
```

The `chain` line is the whole point: it shows every level git walked, from the
repository root down to the path you asked about. When the file is tracked anyway,
the output says so:

```text
$ gid explain trace.log
path:   trace.log
status: ignored
rule:   .gitignore:47  "*.log"  (match on this file)
chain:  trace.log -> .gitignore#47 (excluded)
git:    tracked
note:   git keeps tracking this path until you run `git rm -r --cached trace.log`; ignoring a tracked file has no effect.
```

`--json` gives machine-readable fields (`path`, `ignored`, `source`, `line`,
`pattern`, `reason`, `whitelistedBy`, ...):

```json
$ gid explain .env --json
{
  "path": ".env",
  "ignored": false,
  "source": null,
  "line": null,
  "pattern": null,
  "reason": "no ignore rule matches this path",
  "whitelistedBy": null,
  "matchedPath": null,
  "viaAncestor": false,
  "isDir": false,
  "exists": true,
  "tracked": false,
  "note": null
}
```

### `gid check`

Four kinds of finding, each with a concrete fix:

| Kind | Meaning |
| --- | --- |
| **LEAK** | The file is tracked by git **and** matches an ignore rule. Secrets here are already in history. Sorted by danger: `.env` -> keys -> logs -> databases. |
| **MISSING** | Untracked, not ignored, but obviously should be (`.env`, `*.log`, `node_modules/`, `.DS_Store`, ...). |
| **DEAD** | A rule that matches zero files in this repository — usually stale copy-paste. |
| **CONFLICT** | A rule fully shadowed by a later rule, so it can never decide anything. |

Exit code is `1` when there is a LEAK or MISSING (or any finding with `--strict`),
`0` otherwise.

```bash
gid check            # human readable, 8 findings per kind
gid check --all      # every finding
gid check --strict   # DEAD and CONFLICT also fail the build
gid check --json     # full machine-readable report
```

### `gid list [--why]`

Every active rule with how many files it actually matches — the fastest way to
spot a `.gitignore` that has rotted:

```text
$ gid list
repository: C:\Users\Administrator\AppData\Local\Temp\gid-demo

.gitignore
     2  .dsh-meow/                             0  (matches 0)
     3  .dsh-mattskillsdeck-cache/             0  (matches 0)
     4  .dsh-pocket/                           0  (matches 0)
     5  .dsh/                                  0  (matches 0)
   ...
    47  *.log                                  2
    48  tmp/                                   0  (matches 0)

total: 40 rule(s)
```

`--why` adds a one-line explanation of what the rule's shape actually means:

```text
    40  node_modules/                          1
        why: ignore, directories only, matches at any depth
```

### `gid init [--detect] [--force]`

Detect the stacks from directory markers and generate a grouped `.gitignore`,
naming the evidence for every section:

```text
$ gid init
wrote C:\Users\Administrator\AppData\Local\Temp\gid-init-demo\.gitignore
detected:
  node         <- package.json
  python       <- pyproject.toml
```

Detected stacks: node, python, go, rust, java, macos, windows, jetbrains, vscode.
An existing `.gitignore` is never overwritten unless you pass `--force`.

## How it works

1. `collectIgnoreFiles` walks from the repository root down to the target path,
   reading every `.gitignore` on the way plus `.git/info/exclude`; each file's rules
   are anchored to the directory that owns the file.
2. `parseIgnoreFile` turns every line into a structured rule (negation,
   directory-only, anchored, source file + line number).
3. `matchPath` evaluates **every ancestor first**, shallow to deep, because an
   excluded directory hides its contents no matter what a later rule says. Inside
   one level the last matching rule wins. That is the whole "why doesn't my `!`
   rule work" mystery.
4. `checkRepo` reuses the same matcher over the working tree plus `git ls-files` to
   classify findings into LEAK / MISSING / DEAD / CONFLICT.

Gitignore semantics are implemented from scratch (`**`, character classes, escapes,
trailing-space rules); `git` is only used to list tracked files, never as the matcher.

## API

The CLI is a thin shell over a pure library. Nothing in `src/index.ts` reads
`process.argv` or calls `process.exit`.

```ts
import { parseIgnoreFile, matchPath, explainPath, checkRepo } from "gitignore-doctor";

const rules = parseIgnoreFile("dist/\n!dist/keep.js\n", { source: ".gitignore" });
matchPath(rules, "dist/bundle.js", false);
// -> { ignored: true, viaAncestor: true, matchedPath: "dist", ... }

const verdict = await explainPath("dist/bundle.js", { cwd: process.cwd() });
// verdict.rule?.source, verdict.rule?.line, verdict.reason, verdict.note

const report = await checkRepo(process.cwd(), { strict: false });
// report.counts -> { LEAK, MISSING, DEAD, CONFLICT }, report.failed -> boolean
```

Exported: `parseIgnoreFile`, `matchPath`, `ruleMatches`, `explainPath`, `checkRepo`,
`collectIgnoreFiles`, `flattenRules`, `findRepoRoot`, `detectStacks`,
`generateIgnoreFile`, `globToRegExpSource`, `toPosix`, and the `IgnoreRule` /
`MatchResult` / `ExplainResult` / `Issue` / `CheckReport` types.

## FAQ and limits

- **Does it replace `git check-ignore`?** No. `gid` understands the same rules but
  answers different questions (why, plus what is dead or missing). `git` is still the
  authority on what is actually tracked.
- **Global gitignore** (`core.excludesFile`) is **off by default**; pass `--global`
  to `explain` to include it. It is read from `~/.config/git/ignore` and
  `~/.gitignore_global`.
- **`.git/info/exclude`** is included for `explain`; excluded from `check`.
- **DEAD is a heuristic.** A rule like `*.pyc` is dead only because no `.pyc` exists
  *right now*; that does not make it useless. `check` never fails on DEAD unless you
  ask for `--strict`.
- **CONFLICT is a heuristic too** — it only reports rules that are *fully* shadowed by
  an identical-or-broader later rule in the same file.
- **It does not rewrite your history.** If a secret is in a commit, `gid` tells you to
  `git rm --cached`; rotating the credential and rewriting history is on you.
- **Not a formatter.** No sorting, no whitespace opinions.

## License

[MIT](./LICENSE) (c) 2026 kesheC

---

# gid — 解释与体检你的 .gitignore 规则

**精确知道一个文件为什么被忽略，以及仓库里到底混进了什么不该进的东西。**

## 中文说明

`.gitignore` 是唯一没人 review 的配置文件。规则在项目之间抄来抄去，否定规则悄无
声息地输给更早的目录排除，而最危险的失效方式完全看不见：**git 早就把文件跟踪了，
那条保护 `.env` 的规则一点作用都没有。** `git check-ignore -v` 一次只能回答一个
路径，也完全不告诉你哪些规则是死的、哪些该有却没有、哪些文件已经泄漏进了历史。

## 安装

`gid` **没有发布到 npm registry**（那个名字属于另一个不相干的包）。每个 release
都附带可直接安装的 tarball：

```bash
npm install -g https://github.com/kesheC/gitignore-doctor/releases/download/v0.1.1/gitignore-doctor-0.1.1.tgz
gid --version
```

或者从源码自己编译：

```bash
git clone https://github.com/kesheC/gitignore-doctor.git
cd gitignore-doctor
npm ci && npm run build && npm link
```

需要 Node.js >= 20.11。**零运行时依赖** —— 全部基于 Node 标准库。

## 快速开始

```bash
cd 你的仓库
gid check
```

真实输出（针对一份 53 行的真实 `.gitignore` 副本，在临时仓库里运行；DEAD 只截取
前几条，实际打印了 38 条）。完整输出见上方英文章节。

```text
$ gid check
summary: 1 leak, 1 missing, 38 dead, 0 conflict
result:  FAIL (2 blocking)
```

退出码为 `1`，可以直接当 pre-commit 或 CI 门禁使用。

## 用法

### `gid explain <path>`

这个路径为什么被忽略？是谁、哪一行、哪条规则干的？

```text
$ gid explain node_modules/left-pad/index.js
path:   node_modules/left-pad/index.js
status: ignored
rule:   .gitignore:40  "node_modules/"  (directory-only match on ancestor "node_modules")
chain:  node_modules -> .gitignore#40 (excluded)
git:    untracked
note:   the parent directory 'node_modules' is excluded, so git never looks inside it; re-including a child needs the parent re-included first.
```

`chain` 是重点：它列出 git 从仓库根一路走到目标路径经过的每一层。如果文件其实已被
跟踪，输出会直接点破。`--json` 输出机器可读字段：`path` / `ignored` / `source` /
`line` / `pattern` / `reason` / `whitelistedBy` 等。

### `gid check`

四类问题，每条都给出可执行的修复建议：

| 类型 | 含义 |
| --- | --- |
| **LEAK** | 文件已被 git 跟踪，**同时**命中忽略规则。密钥在这类文件里等于已经进了历史。按危险度排序：`.env` -> 私钥 -> 日志 -> 数据库。 |
| **MISSING** | 未跟踪、也没被忽略，但显然应该忽略（`.env`、`*.log`、`node_modules/`、`.DS_Store` 等）。 |
| **DEAD** | 这条规则在本仓库里匹配 0 个文件，通常是抄来忘了删的。 |
| **CONFLICT** | 规则被后面更宽的规则完全遮蔽，永远轮不到它生效。 |

存在 LEAK 或 MISSING 时退出码为 `1`（`--strict` 下任何问题都为 `1`），否则 `0`。

```bash
gid check            # 人类可读，每类最多 8 条
gid check --all      # 全部列出
gid check --strict   # DEAD / CONFLICT 也算失败
gid check --json     # 完整机器可读报告
```

### `gid list [--why]`

列出所有生效规则，以及每条规则实际命中多少个文件 —— 一眼看出 `.gitignore` 烂到了
什么程度。`--why` 追加一行解释这条规则的语义。

```text
    40  node_modules/                          1
        why: ignore, directories only, matches at any depth
```

### `gid init [--detect] [--force]`

根据目录里的标记文件识别技术栈，生成分组 `.gitignore`，并**说明识别依据**：

```text
$ gid init
wrote C:\Users\Administrator\AppData\Local\Temp\gid-init-demo\.gitignore
detected:
  node         <- package.json
  python       <- pyproject.toml
```

支持识别的技术栈：node / python / go / rust / java / macos / windows / jetbrains /
vscode。已存在的 `.gitignore` 不会被覆盖，除非加 `--force`。

## 工作原理

1. `collectIgnoreFiles` 从仓库根逐层走到目标路径，读取沿途每一个 `.gitignore`，再
   加上 `.git/info/exclude`；每个文件的规则以它所在目录为锚点。
2. `parseIgnoreFile` 把每一行解析成结构化规则（是否否定、是否仅目录、是否锚定、
   来源文件与行号）。
3. `matchPath` **先逐层判断祖先目录**（由浅到深），因为被排除的目录会连同里面的一
   切被隐藏，后面写什么 `!` 都没用。同一层内最后匹配的规则获胜。这正是「我的 `!`
   为什么不起作用」的全部答案。
4. `checkRepo` 用同一个匹配器扫工作区，配合 `git ls-files` 把问题分成
   LEAK / MISSING / DEAD / CONFLICT。

gitignore 语义是自行实现的（`**`、字符类、转义、尾随空格规则）；`git` 只用来列出
已跟踪文件，从不作为匹配引擎。

## API

CLI 只是纯库外面的一层壳。`src/index.ts` 里没有任何 `process.argv` 或
`process.exit`，可以直接当库用（签名与英文示例相同）。

## 常见问题与边界

- **它替代 `git check-ignore` 吗？** 不。`gid` 懂同样的规则，但回答的是不同的问题
  （为什么、以及哪些是死的/缺的）。「到底什么被跟踪」的权威仍然是 git 自己。
- **全局 gitignore**（`core.excludesFile`）默认**关闭**；`gid explain --global` 才
  纳入，读取 `~/.config/git/ignore` 与 `~/.gitignore_global`。
- **`.git/info/exclude`** 在 `explain` 中生效，在 `check` 中不参与。
- **DEAD 是启发式判断。** `*.pyc` 现在匹配不到，只说明此刻没有 `.pyc`，不代表这条
  规则没用。不加 `--strict` 时 `check` 不会因 DEAD 失败。
- **CONFLICT 也是启发式** —— 只报告被同文件内更宽规则**完全**遮蔽的规则。
- **它不改写你的历史。** 密钥已经进了 commit，`gid` 只能告诉你 `git rm --cached`；
  轮换凭据、重写历史得你自己来。
- **它不是格式化工具。** 不排序、不对空白发表意见。

## 许可证

[MIT](./LICENSE) (c) 2026 kesheC