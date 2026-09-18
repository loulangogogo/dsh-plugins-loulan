# dsh-plugins-loulan

A **DeepSeek Harness (DSH) multi-plugin development project** (pnpm monorepo). It currently contains three plugins:

| Plugin (package name) | Directory | Purpose                                                                     |
|---|---|---|
| `dsh-loulan-mcp` | [packages/mcp](packages/mcp) | Automatically reads the project's `.mcp.json` and mounts its MCP servers into DSH; under the Web profile it additionally provides an "MCP" tab |
| `dsh-plugin-hello` | [packages/hello](packages/hello) | Registers the slash command `/hello`, which prints `你好` in the chat UI (test plugin) |
| `dsh-loulan-rules` | [packages/rules](packages/rules) | Reads the rule files under the global `~/.dsh/rules` and the project's `.dsh/rules`, and injects them into the session |

The full documentation for each plugin (core capabilities, configuration, constraints, FAQ, design notes) lives in its own docs; this file is only the project-level index:

- [packages/mcp/README.md](packages/mcp/README.md), [packages/mcp/AGENTS.md](packages/mcp/AGENTS.md) (AI collaboration guidance for that package)
- [packages/hello/README.md](packages/hello/README.md)
- [packages/rules/README.md](packages/rules/README.md)

---

## Directory structure

```text
dsh-plugins-loulan/
├── cordis.yml              # patch overlay: inserts the three plugins into the DSH composition via their source entries
├── package.json            # workspace root: dev / link:dsh / test-mcp / test-rules / typecheck
├── pnpm-workspace.yaml
├── tsconfig.json           # whole-repo type check (excludes the browser halves)
├── .mcp.json.example       # MCP configuration example (rename to .mcp.json to use)
├── scripts/
│   ├── dsh.env             # shared environment config: DSH_HARNESS (default ~/.dsh/deepseek-harness)
│   ├── link-dsh.sh         # symlinks the harness's @deepseek-ai/* packages
│   ├── dev.sh              # starts the DSH Web UI with this overlay (port 13080)
│   ├── test-mcp.sh         # starts the Web UI with only the mcp plugin loaded (port 13080, builds first)
│   └── test-rules.sh       # starts the Web UI with only the rules plugin loaded (port 13081, builds first)
└── packages/
    ├── mcp/                # plugin 1: dsh-loulan-mcp
    ├── hello/              # plugin 2: dsh-plugin-hello
    └── rules/              # plugin 3: dsh-loulan-rules
```

## What a plugin is

In DSH, a plugin is simply a TypeScript module that exports an `apply(ctx, config)` function. When the framework
loads it, it calls `apply` with a `ctx` (context object); through `ctx` the plugin registers event
listeners, tools, services and other capabilities, all of which are cleaned up automatically on unload.

## Environment setup

1. You need a working DeepSeek Harness checkout (this project assumes by default that it is at
   `~/.dsh/deepseek-harness`; override it with `DSH_HARNESS`, see `scripts/dsh.env`).
2. Node ≥ 23.6 (≥ 24 recommended; this project is developed against Node 26), with native TypeScript type
   stripping.

## Install and link

```sh
# 1. (Optional) install TypeScript / @types/node for local type checking
pnpm install

# 2. Symlink the harness's @deepseek-ai/* packages into this project so the plugins can import them
pnpm link:dsh -- ~/.dsh/deepseek-harness
# or
DSH_HARNESS=~/.dsh/deepseek-harness pnpm link:dsh
```

> `pnpm install` rebuilds `node_modules` and wipes manual symlinks, so you must re-run
> `pnpm link:dsh` after every `pnpm install`.

## Running

| Command | Purpose |
|---|---|
| `pnpm dev` | Starts the Web UI with the root `cordis.yml`; all three plugins use their source entries, port **13080** |
| `pnpm test-mcp` | Builds `dsh-loulan-mcp` first, then starts the Web UI with only `packages/mcp/cordis.patch.yml` (port 13080) |
| `pnpm test-rules` | Builds `dsh-loulan-rules` first, then starts the Web UI with only `packages/rules/cordis.patch.yml` (port 13081) |
| `pnpm typecheck` | Whole-repo type check using the root `tsconfig.json` (excluding each package's browser half) |

> ⚠️ `test-mcp` / `test-rules` sound like unit tests, but they **actually mean "build first, then start the Web UI"**;
> the real unit tests live inside each package — use `pnpm --filter <package-name> test`.

After starting, open <http://127.0.0.1:13080> (for `pnpm test-rules` it is 13081). `pnpm dev` is equivalent to:

```sh
cd ~/.dsh/deepseek-harness
pnpm dsh web --patch /absolute/path/dsh-plugins-loulan/cordis.yml --port 13080
```

---

## Plugin 1: dsh-loulan-mcp

Loaded separately by lifecycle:

- **At startup**: reads `.mcp.json` from the `.dsh` root directory (`cwd`, defaults to `$DSH_HOME` or `~/.dsh`) and
  mounts it globally (shared by all agents).
- **When an agent is created/restored**: reads `.mcp.json` from that agent's workspace
  (`session.header.cwd`) and mounts it into that session (visible only to conversations in that workspace;
  unloaded automatically when the agent is destroyed).

**Lookup rule: `.mcp.json` is looked up only in the starting directory itself; parent directories are not searched upward.**

Each `mcpServers` entry in `.mcp.json` is mounted as one `@deepseek-ai/dsh-mcp-client` instance:

| .mcp.json entry | Mapped to |
|---|---|
| Contains a string `command` | `transport: stdio` (`args` / `env` / `cwd` optional) |
| Contains a string `url` | `transport: streamable-http` (`headers` optional) |
| Both present | Treated as `command` (stdio takes priority) |
| Neither present | The entry is skipped and a warning is printed |
| `type` field | Currently not used in the decision; setting it does not affect the result |

Tools are exposed to the model as `mcp__<serverName>__<tool>`; workspace mounts append a session-unique
suffix to `serverName` (e.g. `postgres_9f2c1a7b3d5e`), so multiple sessions in the same workspace do not conflict.

### Example .mcp.json

Copy [.mcp.json.example](.mcp.json.example) to `.mcp.json` in your working directory:

```json
{
  "mcpServers": {
    "memory": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-memory"]
    },
    "remote-api": {
      "type": "streamable-http",
      "url": "https://example.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

### The "MCP" tab and HTTP endpoints

Under the Web profile (a profile that provides `webServer`), the view area gains an
**"MCP" tab** at the same level as "Chat" and "Trajectory". It lists service names, transports and
tool names in three groups — "This workspace / Manually added / Global shared" — and supports refresh, add and
unload. The endpoints registered by the Host half are:

| Endpoint | Purpose |
|---|---|
| `GET /dsh-loulan-mcp/mounts?sessionId=…` | Reads the three group listings (aligning first with the global config on disk) |
| `POST /dsh-loulan-mcp/refresh` | Global incremental remount + remount of the current session |
| `POST /dsh-loulan-mcp/add` | Uploads a `.mcp.json` and mounts it to the current session (limit 256 KiB) |
| `POST /dsh-loulan-mcp/unload` | Unloads one source group of the current session (global shared always returns `400`) |

The three write endpoints return `409` while any agent is `running` (idle protection). Display information
flows only through the plugin's in-memory registry and the HTTP endpoints; it **does not write session logs and does not
enter the model context**.

### Configuration

```yaml
- id: dsh-loulan-mcp
  name: /absolute/path/packages/mcp/src/index.ts
  config:
    cwd: /path/to/.dsh           # .dsh root directory (loaded globally at startup); defaults to $DSH_HOME / ~/.dsh; workspaces load dynamically with the agent and need no configuration
```

### Development and release

```sh
pnpm --filter dsh-loulan-mcp test     # unit tests (node:test + the tsx bundled with the harness)
pnpm --filter dsh-loulan-mcp build    # Host tsc + client type check + esbuild bundling of lib/client.js
pnpm --filter dsh-loulan-mcp release  # log in and publish to npm
```

This plugin has both a Host half and a browser half: `package.json` declares `dsh.client`, so
**the build artifact `lib/client.js` must exist**; declaring it without building makes Web startup report an
aggregation error, and after changing client code you must rebuild and refresh the page.

## Plugin 2: hello [test plugin]

Registers the global slash command `/hello` through the command registry of `@deepseek-ai/dsh-commands`.
After typing `/hello` in the chat box, the command handler returns `{ kind: 'success', text: '你好' }`, and the chat UI
renders `你好` directly; the model is not involved and conversation behavior does not change.

- Fixed output `你好`, with no configuration options and no argument parsing.
- `inject: ['commands']` declares the dependency on the command registry service.

```yaml
- id: hello
  name: /absolute/path/packages/hello/src/index.ts
```

Once published as a bundle it can be installed directly (`dsh.bundle.patch` in `package.json` points to the
in-package [cordis.patch.yml](packages/hello/cordis.patch.yml)):

```sh
dsh plugin --profile <profile> add dsh-plugin-hello
```

Development and release:

```sh
pnpm --filter dsh-plugin-hello test     # unit tests (node:test + the tsx bundled with the harness)
pnpm --filter dsh-plugin-hello build    # tsc emits lib/
pnpm --filter dsh-plugin-hello pack     # prepack builds automatically and produces a tarball
pnpm --filter dsh-plugin-hello release  # log in and publish to npm
```

> The plugin entry is the compiled artifact `lib/index.js`: DSH loads plugins from the profile's
> `node_modules`, and Node refuses to strip types from `.ts` sources under `node_modules`
> (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so distribution must use compiled JS.

## Plugin 3: rules

On the first `agent/pre-step` of a session, reads all rule files under the rule directories and injects them into the conversation:

- **Global**: `$DSH_HOME/rules` (defaults to `~/.dsh/rules`).
- **Project**: `<cwd>/.dsh/rules` under the session's working directory.

Regular files are read recursively (symbolic links are skipped), global first and project second, and are combined
into a single user-role `<system-reminder>` folded into the request batch (immediately after the user's direct
input). Rules persist with the history and are not injected again when a session is restored; after being
shadowed by compaction they are automatically restored at the next pre-step. The default per-file limit is
256 KiB and the total budget is 64 KiB; files that exceed the limit are omitted entirely and noted in the message.

```yaml
- id: rules
  name: /absolute/path/packages/rules/src/index.ts
  config:
    dshHome: /path/to/.dsh   # defaults to $DSH_HOME or ~/.dsh
    maxBytes: 65536          # byte limit for the whole rule message; <=0 disables injection
    maxSourceBytes: 262144   # byte limit for a single rule file; larger files are omitted entirely
```

Once published as a bundle it can be installed directly (in-package [cordis.patch.yml](packages/rules/cordis.patch.yml)):

```sh
dsh plugin --profile <profile> add dsh-loulan-rules
```

Development and release:

```sh
pnpm --filter dsh-loulan-rules test     # unit tests (node:test + the tsx bundled with the harness)
pnpm --filter dsh-loulan-rules build    # tsc emits lib/
pnpm --filter dsh-loulan-rules pack     # prepack builds automatically and produces a tarball
pnpm --filter dsh-loulan-rules release  # log in and publish to npm
```

## Caveats

- **The patch overlay's `name` uses relative paths** (e.g. `./packages/hello/src/index.ts` in the root
  `cordis.yml`): the loader resolves them relative to **the directory containing the patch file itself**, so the
  whole project can be moved as a unit without changing any paths; you only need to update them if you move a
  plugin directory to a new location relative to this file. The in-package `cordis.patch.yml` likewise uses
  `./lib/index.js`, so it still resolves to its own artifact after being published as a bundle.
- When wired in from source (root `cordis.yml` + `pnpm dev`), Host-side source uses erasable TypeScript
  syntax (type annotations / `interface` / `import type` only) and runs directly on Node's native type
  stripping, with no build required; **installing a published bundle, and the mcp browser half, do require a
  `build` first**.
- This project's `@deepseek-ai/*` dependencies come from symlinks into the harness checkout and are not on the
  npm registry; for distribution use bundle packaging instead (`dsh.bundle` + `dsh plugin add`).
