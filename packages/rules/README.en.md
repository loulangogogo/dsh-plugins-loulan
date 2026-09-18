# dsh-loulan-rules

English | [中文](README.md)

> **Turn the rule files scattered under `.dsh/rules` into rule context that every conversation carries with it.**

`dsh-loulan-rules` is a rule-injection plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (DSH):

- **Global**: reads `$DSH_HOME/rules` (default `~/.dsh/rules`), shared by all projects;
- **Project**: reads `<cwd>/.dsh/rules` under the session working directory, following the project;
- **Injected on first entry**: on the first `agent/pre-step` it combines all rules into one user-role `<system-reminder>` that persists in the session history.

It is **not** a replacement for `AGENTS.md`; it is a rule-directory loader that can be split by topic and layered per global/project scope. The two can be enabled at the same time.

## 30-second overview

| | |
|---|---|
| **Zero config** | Drop rule files into `~/.dsh/rules` or `<project>/.dsh/rules`; no configuration needed |
| **Layered** | Global first, project after; project rules are more specific and should take precedence over global ones |
| **Persistent** | The injection is an ordinary `user/message` event that stays in history and rides along on every later request |
| **Idempotent** | Resuming a session or hot-reloading the plugin never injects twice; if the visible history already holds this plugin's rules message, it is skipped |
| **Bounded** | Single-file default cap 256 KiB, whole-message default cap 64 KiB; files that do not fit are omitted entirely and listed in the message |
| **Escaped** | A literal `</system-reminder>` inside rule text is escaped, so repository text cannot close the plugin's frame early |

**Compatibility**: it depends on the `@deepseek-ai/cordis`, `@deepseek-ai/dsh-agent`, and `@deepseek-ai/dsh-llm` packages supplied by the DSH runtime (see `peerDependencies` in `package.json`); the plugin is UI-agnostic and works in any profile.

## Contents

- [1. What problem it solves](#1-what-problem-it-solves)
- [2. Core capabilities](#2-core-capabilities)
- [3. Installation](#3-installation)
- [4. Usage](#4-usage)
- [5. Configuration](#5-configuration)
- [6. How it works](#6-how-it-works)
- [7. Constraints and known limitations](#7-constraints-and-known-limitations)
- [8. FAQ](#8-faq)
- [9. Development and release](#9-development-and-release)
- [10. Design notes](#10-design-notes)

---

## 1. What problem it solves

DSH already supports `AGENTS.md`/`CLAUDE.md` natively (loaded by `@deepseek-ai/dsh-agent-instructions`): one user-global file plus fixed candidate names in every directory from the project root down to the session cwd. That covers most cases. This plugin targets a different set of preferences:

- splitting rules **into multiple files by topic**, instead of one `AGENTS.md` per directory;
- keeping rules in **one dedicated rules directory**, instead of scattering them across business directories or occupying the generic `AGENTS.md` name;
- wanting the simplicity and determinism of **one full injection**, without per-scope incremental reconciliation and change notifications.

It deliberately stays simple: **no file watcher, no per-file change notifications, no import or directory-rule-system parsing.** Rules are read once, when the session first enters, and then take effect through history; both loaders can be enabled together.

| Dimension | `AGENTS.md` (built-in) | `dsh-loulan-rules` |
|---|---|---|
| Naming and location | Fixed candidate names per directory (`AGENTS.md`/`CLAUDE.md` + `.local` overlays) | Fixed directories `~/.dsh/rules` and `<cwd>/.dsh/rules`, any file names |
| Coverage | One user-global file + the project directory chain | **All regular files** under the two directories (recursive) |
| Change tracking | Refreshes on filesystem touches, per-scope reconciliation | None; injection happens once |
| After compaction | Per-scope self-healing | The whole set is re-injected |
| Common ground | Both are low-authority user context; both escape `</system-reminder>`; both have a byte budget | Same |

## 2. Core capabilities

| Capability | Description |
|---|---|
| Two sources | Global `$DSH_HOME/rules` and project `<cwd>/.dsh/rules`, active at the same time |
| Deterministic order | Global first, project after; within a directory files are sorted by absolute path, so the result is stable and reproducible |
| Recursive collection | Reads subdirectories recursively; symbolic links (files or directories) are always skipped to avoid cycles |
| Bounded reading | A file larger than `maxSourceBytes` is omitted entirely; nothing is truncated or half-injected |
| Bounded rendering | The whole message stays within `maxBytes`; files that do not fit are recorded as omitted and their paths are listed in the message |
| Once per session | Injected only once during normal session flow; resuming or hot-reloading does not repeat; after being shadowed by compaction it is re-injected on the next pre-step |
| Idempotent dedup | Skipped when the visible history or this step's claimed messages already contain this plugin's rules message |
| Off switch | Setting `maxBytes` to `<=0` or a non-finite value disables injection entirely |

## 3. Installation

### 3.1 From a profile (after the package is published)

```sh
dsh plugin --profile web add dsh-loulan-rules
```

This installs the package into the profile directory and, because the package declares `dsh.bundle.patch`, adds it to `dsh.profile.bundles`; restart DSH for it to take effect. Use `dsh --profile web --dump-config` to check whether the corresponding patch layer appears.

### 3.2 From source (the current development setup)

Prerequisites: a runnable DSH checkout (default `~/.dsh/deepseek-harness`) and Node ≥ 23.6.

```sh
pnpm install

# Link the harness's @deepseek-ai/* packages so source can import them like an in-monorepo plugin
pnpm link:dsh                                # reads DSH_HARNESS, defaults to ~/.dsh/deepseek-harness
pnpm link:dsh -- /path/to/deepseek-harness   # or point at a harness path explicitly

# Start the Web UI with this repo's cordis.yml as the patch overlay (fixed port 13080)
pnpm dev
```

The repo-root `cordis.yml` already wires `packages/rules` into the overlay through the source entry `./packages/rules/src/index.ts`, so `pnpm dev` picks it up automatically.

> `pnpm install` rebuilds `node_modules` and may install a second copy of `@deepseek-ai/*` for peer dependencies; **afterwards delete `packages/rules/node_modules` and re-run `pnpm link:dsh`** (see [FAQ](#after-pnpm-install-the-ide-is-covered-in-red-squiggles)).

### 3.3 Verify it works

1. Create a new session (or use one that has not been injected yet) and send a message;
2. The session's request history should contain a `<system-reminder>` with `Rules from: ~/.dsh/rules/...` and `Rules from: .dsh/rules/...` sections;
3. If there is none, see [FAQ](#why-were-no-rules-injected).

## 4. Usage

### 4.1 Writing rule files

Put global rules in `~/.dsh/rules/` and project rules in `<session working directory>/.dsh/rules/`:

```text
~/.dsh/rules/
├── All.md          # general behavioral guidelines for every project
└── Code.md         # general coding conventions

<project>/.dsh/rules/
├── Team.md         # this project's collaboration agreement
└── Python.md       # this project's Python requirements
```

File content is free text (Markdown is fine) and is injected verbatim, with no summarization or rewriting.

### 4.2 Discovery and ordering

- Both directories are traversed **recursively** for all regular files;
- A missing directory, no files, or a read failure is silently skipped and never affects the session;
- Files within a directory are sorted by absolute path;
- **Symbolic links (files and directories) are always skipped** — this avoids cycles and keeps the rule set deterministic.

### 4.3 When and where injection happens

| Item | Behavior |
|---|---|
| Timing | On the first entering `agent/pre-step` of the session; an empty first batch (which would not start a request) is left as-is |
| Position | Folded **right after the user's direct input** and before the driver-appended runtime context |
| Scope | Per session; the rules persist with that session's history |
| Repetition | Skipped when the visible history or this step's claimed messages already hold this plugin's rules message (no duplication on resume) |
| Changes | **Does not watch** file changes during a run; edited rules take effect in a new session |

### 4.4 Injection shape

The whole message consists of a fixed intro, an optional omission notice, and one `Rules from:` section per file:

```markdown
<system-reminder>
From this point forward, please treat the content I provide next as the **persistent behavioral rules for this conversation**.
… (fixed intro, about 1.5 KB; full text is the INTRO in src/render.ts)

**The following content defines the rules you must continue to follow:**

Rules from: ~/.dsh/rules/All.md

<file text>

Rules from: .dsh/rules/Team.md

<file text>
</system-reminder>
```

The intro is **fixed**, and its bytes also count toward `maxBytes`. Setting `maxBytes` below the intro's size therefore omits every rule file because none of them fit.

### 4.5 Budget and omission

| Case | Behavior |
|---|---|
| Single file > `maxSourceBytes` | The file is omitted entirely and recorded in the omission notice |
| Adding a file pushes the whole message > `maxBytes` | The file is omitted entirely and later, smaller files are still tried |
| The omission notice itself breaks the budget at the end | Files continue to be dropped from the tail until the final text is `<= maxBytes` |
| Everything is omitted | No message is injected (no empty `<system-reminder>`) |

Omitted files are listed at the start of the message as "（已省略超出预算或过大的规则文件：…）".

## 5. Configuration

| Field | Description | Default |
|---|---|---|
| `dshHome` | DSH home directory (global rules live in its `rules/`) | `$DSH_HOME` or `~/.dsh` |
| `maxBytes` | UTF-8 byte cap for the whole rules message; `<=0` or a non-finite value disables injection | `65536` (64 KiB) |
| `maxSourceBytes` | UTF-8 byte cap for a single rule file; larger files are omitted | `262144` (256 KiB) |

All fields are optional; the plugin exports no schemastery schema and simply uses the defaults above. Override them in the profile's `cordis.patch.yml`:

```yaml
- id: rules
  name: dsh-loulan-rules
  config:
    dshHome: /path/to/.dsh
    maxBytes: 65536
    maxSourceBytes: 262144
```

## 6. How it works

```text
~/.dsh/rules/*                    <session cwd>/.dsh/rules/*
        │                                    │
        └──────────────────┬─────────────────┘
                           ▼
           first entering agent/pre-step
           recursive collection (sorted by path, symlinks skipped)
                           ▼
           budget trimming (single file 256 KiB / total 64 KiB)
                           ▼
           render <system-reminder> (escape the closing tag)
                           ▼
   fold into this request's batch: after direct user input, before runtime context
                           ▼
             persistent user/message → rides along in every request
```

**Dedup**: the plugin's rules message has the source `{ kind: 'plugin', plugin: 'rules', form: 'instructions' }`. Before injecting, it scans the claimed messages and the session's visible history; if this plugin's rules message exists, it is skipped, so resuming a session or hot-reloading the plugin never duplicates it.

**Reading**: it reads files with `node:fs` directly and **does not use the `ctx.fs` provider**, so it does not go through DSH's file-sandbox policy — treat the rules directory as trusted input.

**Escaping**: every literal `</system-reminder>` in the body is replaced with `<\/system-reminder>`, so rule content cannot close the plugin-controlled frame early.

## 7. Constraints and known limitations

| Limitation | Description |
|---|---|
| No re-injection on file changes | Editing rules during a session does not re-inject them (no file watcher); start a new session |
| No per-file notifications | No `Updated/Removed instructions` deltas; the whole set is injected once |
| Bypasses the file sandbox | Reads with `node:fs` directly rather than through `ctx.fs`; the rules directory must be trusted |
| No advanced semantics | No imports, no `.claude/rules/`, no directory rule system |
| Symlinks skipped | Neither file nor directory symlinks are followed, to avoid cycles |
| No content truncation | An over-limit file is omitted entirely; a partial file is never injected |
| Fixed intro | The intro is about 1.5 KB and counts toward `maxBytes`; too small a budget injects nothing |
| Trust boundary | Rule text is low-authority user context and does not override system/developer/direct user instructions; it cannot eliminate prompt injection |

## 8. FAQ

### Why were no rules injected

Check in order:

1. **Directory and files**: does `~/.dsh/rules` or `<cwd>/.dsh/rules` exist, and does it hold regular files?
2. **Is the budget too small**: the fixed intro is about 1.5 KB; if `maxBytes` is below that, no file fits. The 64 KiB default never hits this.
3. **Is a single file too large**: files above `maxSourceBytes` (default 256 KiB) are omitted entirely.
4. **Was it already injected**: during normal session flow it is injected once; if the history already holds this plugin's rules message (and it was not removed by compaction), it is not repeated.

### I edited a rule file, why did this conversation not change

The plugin has no watcher and does no live change detection. Rules are read only when the session first enters; start a new session for edits to take effect.

### What happens if a rule contains `</system-reminder>`

It is escaped to `<\/system-reminder>`, so it cannot close the plugin's frame early or let later text escape as system instructions.

### Does it conflict with the `AGENTS.md` plugin

No. Each folds its content into the request batch in its own `agent/pre-step`; they are unaware of each other and can be enabled together. As a rule of thumb, put long-lived cross-project rules in `~/.dsh/rules` and keep repository-level notes in `AGENTS.md`.

### After `pnpm install` the IDE is covered in red squiggles

The root cause is two instances of the same `@deepseek-ai/*` package: the repo-root `node_modules/@deepseek-ai/*` are harness symlinks created by `pnpm link:dsh`, while `packages/rules/node_modules/@deepseek-ai/*` are registry copies that pnpm installed automatically for `peerDependencies`. Branded types (such as `MessageId`) are incompatible between the two declarations, so TypeScript reports `UserMessage | UserMessage` and similar errors.

Fix: delete `packages/rules/node_modules` and run `pnpm link:dsh` again, so resolution falls back to the harness symlinks.

> DSH-generated profiles use `nodeLinker: hoisted` + `autoInstallPeers: false`, so peers are never auto-installed and a real profile install does not hit this duplication; it only affects the development repository (`autoInstallPeers` defaults to `true`). To remove the cause entirely, add `autoInstallPeers: false` to the repo-root `pnpm-workspace.yaml`.

### Will the rules be compacted away

Yes. The injection is an ordinary `user/message` and can be shadowed by compaction. But dedup relies on "is this plugin's rules message still in the visible history"; once it is shadowed it can no longer be detected, so the **next `agent/pre-step` automatically re-injects a full copy of the current rules** (the same compaction self-healing behavior as `@deepseek-ai/dsh-agent-instructions`).

## 9. Development and release

### Layout

```text
packages/rules/
├── src/
│   ├── index.ts        # plugin entry: pre-step hook, dedup, folding into the batch
│   ├── load.ts         # recursive rule discovery, reading, single-file cap and total budget
│   ├── render.ts       # <system-reminder> rendering, fixed intro, closing-tag escaping
│   └── config.ts       # configuration defaults and DSH home resolution
├── test/               # node:test unit tests (run through the harness's bundled tsx)
├── scripts/
│   └── test-unit.sh    # test entry point
├── cordis.patch.yml    # mount patch for packaged distribution (id: rules)
└── tsconfig.build.json # build to lib/
```

### Common commands

```sh
bash scripts/test-unit.sh   # unit tests (node:test + tsx)
pnpm build                  # tsc emits lib/
pnpm pack                   # prepack builds automatically, producing dsh-loulan-rules-<version>.tgz
```

### Artifacts and release conventions

- **`lib/` is not checked in**; it is produced by the build. `package.json`'s `files` includes `lib` and `cordis.patch.yml`.
- `package.json`'s `dsh.bundle.patch` points at `./cordis.patch.yml`, so the package can be installed as a bundle by `dsh plugin add`.
- `prepack` triggers `build` automatically.
- After publishing to npm, users run `dsh plugin --profile <name> add dsh-loulan-rules`; you can also hand over the tarball produced by `pnpm pack`.
- ⚠️ **After deleting a `src/` module, clean `lib/` first**: `tsc` does not remove stale artifacts from the output directory, and leftovers would be published. Running `rm -rf lib` before a build is the simplest safeguard.

### Dependency conventions

`@deepseek-ai/cordis`, `@deepseek-ai/dsh-agent`, and `@deepseek-ai/dsh-llm` are provided by the DSH runtime, so they are declared as `peerDependencies`; **do not put them in `dependencies`** — that installs a second copy and breaks both runtime and types.

## 10. Design notes

This plugin is a lightweight variant of DSH's native workspace-instruction loader `@deepseek-ai/dsh-agent-instructions`. For background and trade-offs, see:

| Material | Content |
|---|---|
| [deepseek-harness repository](https://github.com/deepseek-ai/deepseek-harness) | The DSH main repository |
| `packages/context/agent-instructions` (inside the harness) | The `AGENTS.md`/`CLAUDE.md` loader: candidate files, project-root discovery, budgeted rendering, dynamic refresh, and compaction self-healing |
| `.agents/notes/archived/feature/2026-06-24-workspace-context.md` (inside the harness) | The workspace-context design decision record, including why it does not use a system-prompt section |

Differences from `dsh-agent-instructions`: this plugin does only "all files under a directory + once per session + one whole-message budget". It does not track per-file changes and does not follow symlinks; after compaction it re-injects the whole set because the rules message has disappeared from the visible history, rather than reconciling per scope.
