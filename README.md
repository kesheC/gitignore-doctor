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

`gid` is **not published to the npm registry.** The `gitignore-doctor` name is still
free; this project just has no publishing credentials yet. Every release ships a
tarball you can install directly:

```bash
npm install -g https://github.com/kesheC/gitignore-doctor/releases/latest/download/gitignore-doctor.tgz
gid --version
```

Every release publishes the same tarball under a stable name (`gitignore-doctor.tgz`) alongside a
`gitignore-doctor.tgz.sha256` checksum. To verify the download before running it:

```bash
curl -sLO https://github.com/kesheC/gitignore-doctor/releases/latest/download/gitignore-doctor.tgz
curl -sLO https://github.com/kesheC/gitignore-doctor/releases/latest/download/gitignore-doctor.tgz.sha256
sha256sum -c gitignore-doctor.tgz.sha256          # gitignore-doctor.tgz: OK
npm install -g ./gitignore-doctor.tgz
```

On macOS use `shasum -a 256 -c gitignore-doctor.tgz.sha256` — there is no `sha256sum` by default.

Or build it from a checkout:

```bash
git clone https://github.com/kesheC/gitignore-doctor.git
cd gitignore-doctor
npm ci && npm run build && npm link
```

Requires Node.js >= 20.11. **Zero runtime dependencies** — everything is Node stdlib.

> Installing straight from git (`npm install -g git+https://github.com/...`) does
> **not** work: the checkout has no build output and a global install skips
> `devDependencies`, so there is no `tsc` to build it with. Use the tarball, or
> clone and build it yourself.

## Quick start

```bash
cd your-repo
gid check
```

Real output, run against a copy of a real 53-line `.gitignore` in a temp repo
(DEAD findings truncated — the real run printed 39 of them). The fixture lives
in this repo, so you can reproduce it line for line; the script prints the
`gid check` command to run against it:

```bash
node demo/make-fixture.mjs
```

Paths are printed as `<temp>/...` here; your own machine will print its real
temp directory. Nothing else is rewritten.

```text
$ gid check
repository: <temp>/gid-demo
scanned:    4 entries, 1 ignore file(s)

LEAK - tracked despite being ignored (1)
  [LEAK] trace.log
        trace.log is tracked by git but matches .gitignore:47 "*.log"
        fix: run `git rm --cached "trace.log"` to stop tracking it (the file stays on disk)
MISSING - should be ignored but is not (1)
  [MISSING] .env
        .env looks like an environment file but no ignore rule covers it
        fix: add a rule such as `.env` to .gitignore
DEAD - rules that match nothing (39)
  [DEAD] .gitignore:2
        .gitignore:2 ".dsh-meow/" matches no file right now
        fix: this is expected for defensive rules (files that only exist after an accident); keep it unless the path really moved
  [DEAD] .gitignore:3
        .gitignore:3 ".dsh-mattskillsdeck-cache/" matches no file right now
        fix: this is expected for defensive rules (files that only exist after an accident); keep it unless the path really moved
  [DEAD] .gitignore:4
        .gitignore:4 ".dsh-pocket/" matches no file right now
        fix: this is expected for defensive rules (files that only exist after an accident); keep it unless the path really moved
  [DEAD] .gitignore:5
        .gitignore:5 ".dsh/" matches no file right now
        fix: this is expected for defensive rules (files that only exist after an accident); keep it unless the path really moved
  [DEAD] .gitignore:6
        .gitignore:6 "*.db-shm" matches no file right now
        fix: this is expected for defensive rules (files that only exist after an accident); keep it unless the path really moved
  [DEAD] .gitignore:7
        .gitignore:7 "*.db-wal" matches no file right now
        fix: this is expected for defensive rules (files that only exist after an accident); keep it unless the path really moved
  [DEAD] .gitignore:10
        .gitignore:10 "projects/*/" matches no file right now
        fix: this is expected for defensive rules (files that only exist after an accident); keep it unless the path really moved
  [DEAD] .gitignore:13
        .gitignore:13 "Thumbs.db" matches no file right now
        fix: this is expected for defensive rules (files that only exist after an accident); keep it unless the path really moved
  ... and 31 more DEAD finding(s); use --all to see them

summary: 1 leak, 1 missing, 39 dead, 0 conflict
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

Exit codes: `0` clean, `1` when there is a LEAK or MISSING (or any finding
with `--strict`), `2` on a usage error — including running it outside a git work
tree, where `check` refuses to pretend the tree is clean. Unknown or misspelled
options are also a `2`, never a silent no-op, and so is a `--cwd` that is not
there:

```text
$ gid list --cwd ./no-such-dir
gid: no such directory: /home/you/no-such-dir
$ gid list --cwd ./package.json
gid: not a directory: /home/you/package.json
```

Only a real directory can be "not a git repository"; saying that about a path
that does not exist sends you looking at git when the path is the problem.

`--` ends option parsing, so a path that begins with a dash can still be
explained:

```text
$ gid explain -- --weird-name
path:   --weird-name
```

```bash
gid check             # human readable, first 8 findings per kind
gid check --all       # every finding (without it: 8 per kind, then "and N more")
gid check --strict    # DEAD and CONFLICT also fail the build
gid check --verbose   # per-finding detail, e.g. the blunt advice for DEAD rules
gid check --json      # full machine-readable report
```

### `gid list [--why]`

Every active rule with how many files it actually matches — the fastest way to
spot a `.gitignore` that has rotted:

```text
$ gid list
repository: <temp>/gid-demo

.gitignore
     2  .dsh-meow/                             0  (matches 0)
     3  .dsh-mattskillsdeck-cache/             0  (matches 0)
     4  .dsh-pocket/                           0  (matches 0)
     5  .dsh/                                  0  (matches 0)
   ...
    40  node_modules/                          0  (matches 0)
   ...
    47  *.log                                  1
    48  tmp/                                   0  (matches 0)

total: 40 rule(s)
hits = files whose name matches the pattern, counted before later rules win; they are not the number of files this rule actually ignores.
```

`--why` adds a one-line explanation of what the rule's shape actually means:

```text
    47  *.log                                  1
        why: ignore, matches at any depth
```

In this fixture `trace.log` is the only file that matches a rule, so 39 rules
report `0` hits — that is what a rotted `.gitignore` looks like, and `gid check`
turns it into DEAD findings.

### `gid init [--detect] [--force]`

Detect the stacks from directory markers and generate a grouped `.gitignore`,
naming the evidence for every section:

```text
$ gid init
wrote <temp>/gid-init-demo/.gitignore
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
- **Global gitignore** is **off by default**; pass `--global` to `explain` or `list`
  to include it. Resolution order: `core.excludesFile` if git has one set, otherwise
  `$XDG_CONFIG_HOME/git/ignore`, then `~/.config/git/ignore`, then `~/.gitignore_global`.
- **`.git/info/exclude`** is included for `explain` and `list`; excluded from `check`,
  which audits the files `.gitignore` itself is responsible for.
- **Case sensitivity follows git.** `core.ignorecase=true` (the default on Windows and
  macOS) makes matching case-insensitive, exactly like git; on Linux it stays
  case-sensitive unless you set it. `explain` reports the resolved value as `ignoreCase`.
- **DEAD is a heuristic.** A rule like `*.pyc` is dead only because no `.pyc` exists
  *right now*; that does not make it useless. `check` never fails on DEAD unless you
  ask for `--strict`.
- **CONFLICT is a heuristic too** — it only reports rules that are *fully* shadowed by
  an identical-or-broader later rule in the same file.
- **It does not rewrite your history.** If a secret is in a commit, `gid` tells you to
  `git rm --cached`; rotating the credential and rewriting history is on you.
- **Not a formatter.** No sorting, no whitespace opinions.

## Security and changes

Found a vulnerability? Please do not open a public issue — [SECURITY.md](SECURITY.md)
explains the private reporting channel and what to include. Every release is written
up in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](./LICENSE) (c) 2026 kesheC

---

# gid — 解释与体检你的 .gitignore 规则

**精确知道一个文件为什么被忽略，以及仓库里到底混进了什么不该进的东西。**

## 痛点

`.gitignore` 是唯一没人 review 的配置文件。规则在项目之间抄来抄去，否定规则悄无
声息地输给更早的目录排除，而最危险的失效方式完全看不见：**git 早就把文件跟踪了，
那条保护 `.env` 的规则一点作用都没有。** `git check-ignore -v` 一次只能回答一个
路径，也完全不告诉你哪些规则是死的、哪些该有却没有、哪些文件已经泄漏进了历史。

## 安装

`gid` **没有发布到 npm registry**。`gitignore-doctor` 这个名字目前还是空的，只是本项目
还没有发布凭据。每个 release 都附带可直接安装的 tarball：

```bash
npm install -g https://github.com/kesheC/gitignore-doctor/releases/latest/download/gitignore-doctor.tgz
gid --version
```

每个 release 都用固定名字（`gitignore-doctor.tgz`）发布同一个 tarball，并附一份
`gitignore-doctor.tgz.sha256` 校验和。运行之前先验一下：

```bash
curl -sLO https://github.com/kesheC/gitignore-doctor/releases/latest/download/gitignore-doctor.tgz
curl -sLO https://github.com/kesheC/gitignore-doctor/releases/latest/download/gitignore-doctor.tgz.sha256
sha256sum -c gitignore-doctor.tgz.sha256          # gitignore-doctor.tgz: OK
npm install -g ./gitignore-doctor.tgz
```

macOS 上没有 `sha256sum`，用 `shasum -a 256 -c gitignore-doctor.tgz.sha256`。

或者从源码自己编译：

```bash
git clone https://github.com/kesheC/gitignore-doctor.git
cd gitignore-doctor
npm ci && npm run build && npm link
```

需要 Node.js >= 20.11。**零运行时依赖** —— 全部基于 Node 标准库。

> 直接从 git 安装（`npm install -g git+https://github.com/...`）**不可行**：checkout 里
> 没有构建产物，而全局安装会跳过 `devDependencies`，本机也就没有 `tsc` 能为它构建。
> 请用 tarball，或者自己 clone 后编译。

## 快速开始

```bash
cd 你的仓库
gid check
```

真实输出（针对一份 53 行的真实 `.gitignore` 副本，在临时仓库里运行）。这里只摘出结尾
两行汇总，实际打印了 39 条 DEAD；完整输出见上方英文章节。这个临时仓库由仓库里自带的
脚本生成，输出可以逐行复现（只有临时目录路径与本机不同）：

```bash
node demo/make-fixture.mjs
```

```text
$ gid check
summary: 1 leak, 1 missing, 39 dead, 0 conflict
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

退出码：`0` 干净，`1` 表示存在 LEAK 或 MISSING（`--strict` 下任何问题都为 `1`），
`2` 表示用法错误 —— 包括在非 git 工作区里运行：这种情况下 `check` 会拒绝假装干净。
拼错的选项同样是 `2`，绝不会被静默忽略；`--cwd` 指向的位置不存在也是 `2`：

```text
$ gid list --cwd ./no-such-dir
gid: no such directory: /home/you/no-such-dir
$ gid list --cwd ./package.json
gid: not a directory: /home/you/package.json
```

只有真实存在的目录才谈得上「不是 git 仓库」；对一个根本不存在的路径这么说，会让
读者去查 git，而真正的问题在路径本身。

`--` 会终止选项解析，所以以短横线开头的文件名照样能解释：

```text
$ gid explain -- --weird-name
path:   --weird-name
```

```bash
gid check             # 人类可读，每类最多 8 条
gid check --all       # 全部列出（不加时每类打印 8 条，然后一行 "and N more"）
gid check --strict    # DEAD / CONFLICT 也算失败
gid check --verbose   # 每条问题给出更直白的建议（例如 DEAD 规则）
gid check --json      # 完整机器可读报告
```

### `gid list [--why]`

列出所有生效规则，以及每条规则实际命中多少个文件 —— 一眼看出 `.gitignore` 烂到了
什么程度。`--why` 追加一行解释这条规则的语义。

```text
    40  node_modules/                          0  (matches 0)
        why: ignore, directories only, matches at any depth
```

这份 fixture 里只有 `trace.log` 命中规则（`*.log`，47 行），另外 39 条都是 0 命中 ——
这就是一份「烂掉的」`.gitignore` 长什么样，`gid check` 会把这些变成 DEAD。

`gid list` 结尾还会打印一行说明：`hits` 统计的是「名字匹配这条规则的文件数」，
是后续规则生效**之前**的数字，不等于这条规则最终实际忽略了几个文件。

### `gid init [--detect] [--force]`

根据目录里的标记文件识别技术栈，生成分组 `.gitignore`，并**说明识别依据**：

```text
$ gid init
wrote <temp>/gid-init-demo/.gitignore
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
- **全局 gitignore** 默认**关闭**；`gid explain --global` 或 `gid list --global` 才
  纳入。查找顺序：git 配了 `core.excludesFile` 就用它，否则依次找
  `$XDG_CONFIG_HOME/git/ignore`、`~/.config/git/ignore`、`~/.gitignore_global`。
- **`.git/info/exclude`** 在 `explain` 与 `list` 中生效，在 `check` 中不参与（`check`
  只审 `.gitignore` 该负责的部分）。
- **大小写跟随 git。** `core.ignorecase=true`（Windows 与 macOS 的默认值）时匹配不区分
  大小写，和 git 一致；Linux 上默认区分，除非你自己配了。`explain` 会把解析出的值作为
  `ignoreCase` 返回。
- **DEAD 是启发式判断。** `*.pyc` 现在匹配不到，只说明此刻没有 `.pyc`，不代表这条
  规则没用。不加 `--strict` 时 `check` 不会因 DEAD 失败。
- **CONFLICT 也是启发式** —— 只报告被同文件内更宽规则**完全**遮蔽的规则。
- **它不改写你的历史。** 密钥已经进了 commit，`gid` 只能告诉你 `git rm --cached`；
  轮换凭据、重写历史得你自己来。
- **它不是格式化工具。** 不排序、不对空白发表意见。

## 安全与变更

发现安全问题请**不要**开公开 issue —— [SECURITY.md](SECURITY.md) 说明了私密上报渠道以及
需要提供哪些信息。每个版本的改动都记在 [CHANGELOG.md](CHANGELOG.md)。

## 许可证

[MIT](./LICENSE) (c) 2026 kesheC