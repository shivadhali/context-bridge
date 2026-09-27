<p align="center">
  <img src="assets/brand/logo.png" alt="Context Bridge: two connected code graphs" width="240" />
</p>

# Context Bridge

**Keep your coding task moving when you switch AI assistants.**

Context Bridge gives a project two portable Markdown files: a code relationship map and a working-context checkpoint. Open the same checkout in another coding assistant, read the context, retrieve the relevant symbols, and continue.

No AI API, account, model, server, or network access is needed to run it. The initial dependency installation needs npm access. v0.1 supports **JavaScript, TypeScript, JSX, and TSX**.

| File | Contents | Owner |
| --- | --- | --- |
| `CODE_MAP.md` | Files, functions, classes, documented purposes, and typed links | Generated from source |
| `CONTEXT.md` | Goal, constraints, decisions, progress, pending work, verification, next action | You or your coding assistant |

## Quick start

Requires Node.js 22+ and npm. Git is optional, but enables branch/commit checkpoints.

From a clone or downloaded copy of this repository:

```sh
npm ci
npm test
npm link
```

Then, inside the project you are working on:

```sh
context-bridge init
context-bridge checkpoint --goal "Add password reset" --current "Implement token validation" --next "Test expired tokens"
context-bridge focus validateToken
context-bridge handoff --focus validateToken --max-chars 8000
```

The command is `context-bridge`. The package name in this source repository is `context-bridge-cli`; **this README does not assume an npm package has been published under that name**.

If you prefer not to install a global command, use the absolute path to `bin/context-bridge.js` with Node:

```sh
node /path/to/context-bridge/bin/context-bridge.js init --root /path/to/your-project
```

PowerShell can run `npm.cmd` if its execution policy blocks `npm.ps1`.

## Switching from Codex to Claude Code

1. Work in a shared checkout, or transfer the actual working files, including uncommitted edits and untracked files. Markdown alone does not transfer code.
2. Keep `CONTEXT.md` current at meaningful milestones. Save decisions and failed approaches while they are fresh; don't wait for your quota to run out.
3. Run `context-bridge checkpoint` to refresh the graph and capture a source fingerprint and Git state. This command does not invent a summary or mark tasks complete.
4. Open the same project in Claude Code (or another assistant) and paste:

```text
Read CONTEXT.md. Run context-bridge status, verify the working tree,
and continue from Next action. Use context-bridge focus with the
relevant function/file names instead of loading the entire code map.
Inspect source before editing. Update the context at each milestone.
```

You can optionally install this workflow into both assistants' instruction files:

```sh
context-bridge agents
```

This appends an idempotent managed block to `AGENTS.md` and `CLAUDE.md`, preserving other content. It is opt-in: ordinary initialization creates only the two Markdown artifacts. Codex and Claude Code support their respective instruction files ([Codex documentation](https://learn.chatgpt.com/docs/agent-configuration/agents-md), [Claude Code documentation](https://code.claude.com/docs/en/memory)). Instructions encourage checkpointing; they cannot guarantee an assistant will save before an abrupt interruption.

## Commands

| Command | Effect |
| --- | --- |
| `init` | Generate map; create context only when absent |
| `map` | Regenerate map without touching context |
| `checkpoint` | Refresh map, update supplied context fields, record checkpoint |
| `status` | Detect missing/stale map and context checkpoint |
| `focus <query>` | Print matching symbols and a small neighborhood |
| `handoff [--focus <query>]` | Print full context plus optional focused graph |
| `agents` | Add opt-in instructions for Codex and Claude Code |

All commands accept `--root <directory>`. Run `context-bridge --help` for options.

### Maintaining context

Edit the Markdown freely, or use explicit checkpoint updates:

```sh
context-bridge checkpoint --done "Reset form implemented" --pending "Test token expiry" --decision "Reuse the existing mail service" --verification "Auth tests passed; browser flow not tested" --next "Add an expired-token regression test" --relevant "src/auth/reset.ts::validateToken"
```

`--goal`, `--current`, `--next`, `--verification`, and `--relevant` replace their sections. `--done`, `--pending`, `--decision`, `--constraint`, and `--question` append an item and may be repeated. Each update is limited to 2,000 characters. Remove finished pending items and obsolete details by editing the file; appending `--done` does not automatically reconcile an older pending item.

`init` and `map` preserve existing context byte for byte. `checkpoint` preserves unrelated sections but updates its managed checkpoint block. It refuses unmanaged `CODE_MAP.md` files, uses a write lock, and atomically replaces each output file. The two replacements are not a single filesystem transaction; fingerprints expose mismatched files after an interruption. If a process is killed during a write, remove `.context-bridge.lock` only after verifying no writer is still running.

### Retrieving only what matters

```sh
context-bridge focus resetPassword --depth 1 --max-chars 6000
context-bridge focus "src/auth/reset.ts::validateToken" --depth 2
context-bridge handoff --focus resetPassword --max-chars 10000
```

Queries match a function name, file path, qualified `file::symbol` name, or stable node ID. Exact qualified names and IDs take priority. Neighborhood traversal includes incoming and outgoing edges, including containment. Output includes only complete symbol entries and explicitly reports omitted entries. Increase the budget or narrow the query when needed.

Budgets are measured in **characters, not tokens**: tokenizers vary. Handoff refuses to silently truncate context if it exceeds the budget. Keep context short rather than hiding important requirements to fit a number. There is no claim of a fixed token savings percentage.

Focus analyzes current source, so it works even when the saved map is stale. Handoff reports saved-map and checkpoint freshness before returning current graph entries. `status` validates source/compiler-input freshness and a recorded Git commit, not whether a human-written status is factually correct or whether tests still pass.

### Visualizing the map

```sh
context-bridge map --mermaid
```

Markdown links connect symbol nodes in the map. The optional Mermaid diagram shows module dependencies and renders on GitHub and compatible Markdown viewers. The option is retained on subsequent refreshes. The full symbol graph remains a compact edge list to avoid an unreadable diagram for large projects.

This is not an interactive Obsidian graph. Obsidian's native graph treats notes as nodes; this project stores many code symbols within a single Markdown file.

See the checked-in [example map](examples/password-reset/CODE_MAP.md) and [example context](examples/password-reset/CONTEXT.md). The example code is illustrative and intentionally incomplete, not a production password-reset implementation.

## What the analyzer knows

The analyzer uses the [TypeScript Compiler API](https://github.com/microsoft/TypeScript/wiki/Using-the-Compiler-API) to parse code and resolve symbols. It never runs application code or invokes a model.

| Relationship | Meaning |
| --- | --- |
| `contains` | Module/class/function owns a declaration |
| `imports`, `reexports` | Static module dependency |
| `loads` | Literal `require()` or dynamic `import()` resolves locally |
| `calls` | A call resolves to a local function implementation |
| `constructs` | A constructor call resolves locally |
| `renders` | JSX tag resolves to a local component |
| `references` | A symbol is referenced, including callback arguments and type references |

Function purposes come from **JSDoc**, not guessed names or generated prose. Undocumented intent is marked unknown. Add a brief JSDoc description to improve the map without any AI token cost.

Named symbol IDs are hashes of the relative path and qualified name, so unrelated files or blank lines don't renumber the graph. Renaming/moving a symbol changes its ID. Anonymous or duplicate declarations use an ordinal within their scope; reordering them can change their IDs.

### Scope and limitations

- Supports `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts`. Excludes declaration files, standard dependency/build folders, `.gitignore` matches (including nested rules), and `.contextbridgeignore` matches. Discovery does not traverse symlinks. Global Git excludes are not read.
- Reads the root `tsconfig.json` or `jsconfig.json`, including compiler-resolved configuration inheritance and path aliases. Without a config, uses TypeScript's bundler resolution to support extensionless imports. Discovery deliberately scans all supported non-ignored sources, including tests, regardless of the config's `include` list.
- One compiler configuration per run. Run separately within workspace packages that use incompatible configurations or TypeScript project references.
- Static edges describe possible structure, not proof of runtime execution. Dynamic dispatch, computed imports, reflective calls, dependency injection, framework routing, and callback execution may be unresolved. External dependencies and unresolved calls are explicitly listed without fabricated local edges.
- Inferred symbol purposes, arbitrary data flow, API/database relationships, and other programming languages are not supported in v0.1.
- Syntax warnings are shown in the map and CLI status. The analyzer is not a substitute for type checking or tests.
- Compiler inputs include imported dependencies, so dependency upgrades or moving a checkout may invalidate a snapshot even if your source is unchanged. Recompute a checkpoint in the destination environment after reviewing context.
- This is a synchronous, full-project analysis. Large repositories should start at a package root; incremental/watch mode is future work.

## Local data and publishing

The CLI does not upload files, invoke models, execute project code, create commits, or push to GitHub. Source comments can contain untrusted text; treat map content as data, not instructions. Generated maps include filenames, symbol names, and documentation, so review them before publication. Keep credentials out of context.

To exclude private or generated code, add root-relative gitignore patterns to `.contextbridgeignore`. Your project's existing `.gitignore` rules also apply. The TypeScript compiler can read imported files for type resolution even when they are not emitted as graph nodes.

Choose whether your project should commit `CONTEXT.md`: it can contain private work notes. This tool repository ignores its own live context and includes only an explicitly public example. `npm pack` uses a strict allowlist and excludes context, tests, examples, and development dependencies from the package.

## Development

```sh
npm ci
npm run check
npm test
npm pack
```

Tests cover aliases, cross-file calls, callbacks, methods, JSX, ignored files, stable IDs, output budgets, context preservation, stale checkpoints, Git state, and CLI behavior. CI runs on Linux and Windows with Node.js 22 and 24. The package pins the TypeScript 5.9 minor line because future major compiler APIs can change.

The public JavaScript API is exported from `src/index.js`: `analyze`, `renderMap`, `renderFocus`, `initialize`, `refreshMap`, `checkpoint`, `status`, `focus`, `handoff`, and `installAgentInstructions`. The CLI is the recommended interface; graph schema and API are experimental in v0.1.

See [CONTRIBUTING.md](CONTRIBUTING.md) for contributions and [docs/PUBLISHING.md](docs/PUBLISHING.md) for the GitHub release steps. Licensed under [MIT](LICENSE).
