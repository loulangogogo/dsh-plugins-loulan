# dsh-plugin-hello

Registers the global slash command `/hello`, which prints `你好` ("hello") in the chat interface.
A pure command plugin: it does not go through the model, parses no arguments, and keeps no
side-effect state.

## Installation

Install it as a DeepSeek Harness (DSH) bundle:

```sh
dsh plugin --profile <profile> add dsh-plugin-hello
```

Or install it from a local tarball:

```sh
pnpm pack
dsh plugin --profile <profile> add ./dsh-plugin-hello-0.1.0.tgz
```

After restarting the corresponding profile, typing `/hello` in the chat box returns `你好`.

## Local development

The `cordis.yml` in the repository root already inserts this plugin into the composition through
its source entry (`./packages/hello/src/index.ts`), so it takes effect as soon as `pnpm dev`
starts.

The `dsh.bundle.patch` field in `package.json` points to `./cordis.patch.yml` inside the package.
Once the package is published as a bundle, `dsh plugin add` automatically appends it to the
profile's `dsh.profile.bundles`.

## Configuration

None.

## Development and release

```sh
bash scripts/test-unit.sh   # Node test runner (via the harness's bundled tsx)
pnpm build                  # tsc emits lib/
pnpm pack                   # prepack builds automatically, producing dsh-plugin-hello-<version>.tgz
pnpm release                # log in and publish to npm
```

## Notes

- The plugin entry point is the compiled artifact `lib/index.js`: DSH loads plugins from the
  profile's `node_modules`, and Node refuses to strip types from `.ts` sources under
  `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). Compiled JS must therefore be
  published.
- `@deepseek-ai/cordis` and `@deepseek-ai/dsh-commands` are used for types only; the compiled
  entry point uses no runtime imports.
