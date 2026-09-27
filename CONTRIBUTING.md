# Contributing

Use Node.js 22+ and install locked dependencies with `npm ci`. Run `npm run check` and `npm test` before opening a pull request.

Keep changes focused on portable, inspectable context. New graph relationships must distinguish evidence from inference. Do not silently label dynamic references as confirmed calls, and do not guess undocumented purpose.

When adding a language or resolving a new syntax pattern:

1. Include a small source fixture in an automated test.
2. Assert the target identity and edge kind, not just that output contains a name.
3. Test a negative/ambiguous case so the analyzer doesn't invent links.
4. Document unsupported cases and any changes to snapshot or stable-ID semantics.

Output writes must preserve human-authored context, refuse symlinks and unmanaged maps, and remain recoverable after interruption. Keep dependencies small and avoid network activity at runtime.

Architecture:

- `src/analyze.js`: file discovery, TypeScript compiler integration, graph extraction.
- `src/markdown.js`: map formatting, bounded graph retrieval, context sections.
- `src/index.js`: file persistence, freshness, checkpoints, integration helpers.
- `bin/context-bridge.js`: argument validation and command routing.

The graph currently uses a single language backend. Add future backends behind the same graph shape (`files`, `nodes`, `edges`, `warnings`, `snapshot`) before expanding the CLI. Potential next contributions include Python AST support, incremental analysis, semantic retrieval, and editor integrations.

Please include reproduction steps and a minimal example in bug reports. Remove private source code and credentials before sharing fixtures or context files.
