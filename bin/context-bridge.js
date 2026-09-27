#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { initialize, refreshMap, checkpoint, status, focus, handoff, installAgentInstructions } from '../src/index.js';

const help = `Context Bridge — portable coding memory in two Markdown files

Usage: context-bridge <command> [query] [options]

Commands:
  init          Create CODE_MAP.md and CONTEXT.md (preserve existing context)
  map           Refresh CODE_MAP.md only
  checkpoint    Refresh map and record Git state + supplied context updates
  status        Check map and checkpoint freshness; exits 2 when stale/incomplete
  focus <query> Print matching symbols and their callers/callees
  handoff       Print context, optionally followed by --focus <query>
  agents        Add managed instructions to AGENTS.md and CLAUDE.md (opt-in)

Options:
  --root <dir>          Project directory (default: current directory)
  --mermaid             Include a Mermaid module graph (init/map/checkpoint)
  --depth <0-3>         Neighborhood depth (default: 1)
  --max-chars <number>  Output character budget (focus: 6000, handoff: 10000)
  --focus <query>       Graph query for handoff
  --goal <text>         Replace goal
  --current <text>      Replace current work
  --next <text>         Replace next action
  --verification <text> Replace verification result
  --relevant <text>     Replace relevant symbols/paths
  --done <text>         Append completed item (repeatable)
  --pending <text>      Append pending item (repeatable)
  --decision <text>     Append decision (repeatable)
  --constraint <text>   Append constraint (repeatable)
  --question <text>     Append open question (repeatable)
  --help               Show this help
  --version            Show version

No model, API key, or network is needed. JavaScript/TypeScript supported.
Budgets measure characters, not provider-specific tokens.
`;

try {
  const options = {
    root: { type: 'string' }, mermaid: { type: 'boolean' }, depth: { type: 'string' },
    'max-chars': { type: 'string' }, focus: { type: 'string' },
    help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' },
  };
  for (const name of ['goal', 'current', 'next', 'verification', 'relevant']) options[name] = { type: 'string' };
  for (const name of ['done', 'pending', 'decision', 'constraint', 'question']) options[name] = { type: 'string', multiple: true };
  const { values, positionals } = parseArgs({ options, allowPositionals: true, strict: true });
  if (values.version) {
    console.log('0.1.0');
  } else if (values.help || !positionals.length) {
    console.log(help);
  } else {
    const [command, query, ...extra] = positionals;
    if (extra.length || (query && command !== 'focus')) throw new Error('Unexpected positional argument. See --help.');
    const root = values.root ?? process.cwd();
    const opts = { ...values };
    if (values.depth !== undefined) {
      opts.depth = Number(values.depth);
      if (!Number.isInteger(opts.depth) || opts.depth < 0 || opts.depth > 3) throw new Error('--depth must be an integer from 0 to 3.');
    }
    if (values['max-chars'] !== undefined) {
      opts.maxChars = Number(values['max-chars']);
      if (!Number.isSafeInteger(opts.maxChars) || opts.maxChars < 500 || opts.maxChars > 1000000) throw new Error('--max-chars must be an integer from 500 to 1000000.');
    }
    const contextFlags = ['goal', 'current', 'next', 'verification', 'relevant', 'done', 'pending', 'decision', 'constraint', 'question'];
    if (command !== 'checkpoint' && contextFlags.some((flag) => values[flag] !== undefined)) throw new Error('Context update options require the checkpoint command.');
    if (values.focus !== undefined && command !== 'handoff') throw new Error('--focus requires the handoff command.');
    if (values.mermaid !== undefined && !['init', 'map', 'checkpoint'].includes(command)) throw new Error('--mermaid requires init, map, or checkpoint.');
    if ((values.depth !== undefined || opts.maxChars !== undefined) && !['focus', 'handoff'].includes(command)) throw new Error('Budget/depth options require focus or handoff.');
    if (command === 'init' || command === 'map') {
      const graph = command === 'init' ? initialize(root, opts) : refreshMap(root, opts);
      console.log(`${command === 'init' ? 'Initialized' : 'Refreshed'}: ${graph.files.length} files, ${graph.nodes.length} graph nodes, ${graph.warnings.length} parser warnings.`);
      if (!graph.files.length) console.warn('No supported sources found. v0.1 supports JS/TS/JSX/TSX, not Python or other languages.');
    } else if (command === 'checkpoint') {
      const result = checkpoint(root, opts);
      console.log(`Checkpoint saved. Context: ${result.contextChars} characters; ${result.graph.files.length} source files.`);
      if (result.contextChars > 12000) console.warn('Context is growing: compact completed work and obsolete details before the next handoff.');
    } else if (command === 'status') {
      const result = status(root);
      console.log(`Map: ${result.map}\nContext checkpoint: ${result.context}\nContext: ${result.contextChars} characters\nParser warnings: ${result.graph.warnings.length}`);
      if (result.map !== 'current' || result.context !== 'current' || result.graph.warnings.length) process.exitCode = 2;
    } else if (command === 'focus') {
      if (!query?.trim()) throw new Error('focus requires a function name, node ID, or file path.');
      process.stdout.write(focus(root, query, opts));
    } else if (command === 'handoff') {
      process.stdout.write(handoff(root, values.focus, opts));
    } else if (command === 'agents') {
      installAgentInstructions(root);
      console.log('Managed instructions installed in AGENTS.md and CLAUDE.md.');
    } else throw new Error(`Unknown command: ${command}. See --help.`);
  }
} catch (error) {
  console.error(`Context Bridge: ${error.message}`);
  process.exitCode = 1;
}
