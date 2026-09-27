import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { analyze, renderMap, renderFocus, initialize, refreshMap, checkpoint, status, handoff, installAgentInstructions } from '../src/index.js';

const cli = fileURLToPath(new URL('../bin/context-bridge.js', import.meta.url));
function fixture(t, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'context-bridge-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}
const project = {
  'src/store.ts': '/** Find an account by ID. */\nexport function findAccount(id: string) { return id; }\nexport function unused() {}',
  'src/index.ts': 'export { findAccount as lookup } from "./store";',
  'src/auth.ts': 'import { lookup } from "./index";\n/** Reset an account. */\nexport const reset = (id: string) => lookup(id);\nexport function run(callback: () => void) { callback(); }\nrun(reset);',
};

test('cross-file aliases and barrel reexports resolve to actual declarations', (t) => {
  const graph = analyze(fixture(t, project));
  const reset = graph.nodes.find((n) => n.name === 'reset');
  const find = graph.nodes.find((n) => n.name === 'findAccount');
  assert.ok(reset.edges.some((e) => e.kind === 'calls' && e.to === find.id));
  assert.equal(find.purpose.text, 'Find an account by ID.');
  assert.equal(reset.purpose.text, 'Reset an account.');
  assert.ok(graph.nodes.find((n) => n.file === 'src/index.ts' && n.kind === 'module').edges.some((e) => e.kind === 'reexports'));
});

test('callback references are not fabricated as executed calls', (t) => {
  const graph = analyze(fixture(t, project));
  const run = graph.nodes.find((n) => n.name === 'run');
  const reset = graph.nodes.find((n) => n.name === 'reset');
  assert.ok(run.unresolved.includes('callback'));
  assert.ok(!run.edges.some((e) => e.to === reset.id));
  const module = graph.nodes.find((n) => n.file === 'src/auth.ts' && n.kind === 'module');
  assert.ok(module.edges.some((e) => e.kind === 'references' && e.to === reset.id));
});

test('methods, constructors, closures, recursion, and same-name functions stay distinct', (t) => {
  const root = fixture(t, {
    'one.ts': 'export class Store { constructor() { this.save(); } save() {} }\nfunction run() { const store = new Store(); store.save(); function inner() { inner(); } inner(); }',
    'two.ts': 'export function run() {}',
  });
  const graph = analyze(root);
  const save = graph.nodes.find((n) => n.name === 'Store.save');
  const run = graph.nodes.find((n) => n.file === 'one.ts' && n.name === 'run');
  const inner = graph.nodes.find((n) => n.name === 'run.inner');
  assert.ok(run.edges.some((e) => e.to === save.id && e.kind === 'calls'));
  assert.ok(inner.edges.some((e) => e.to === inner.id && e.kind === 'calls'));
  assert.equal(new Set(graph.nodes.map((n) => n.id)).size, graph.nodes.length);
});

test('tsconfig aliases and JSX component references resolve', (t) => {
  const graph = analyze(fixture(t, {
    'tsconfig.json': JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['src/*'] }, jsx: 'preserve', moduleResolution: 'bundler', module: 'esnext' } }),
    'src/Button.tsx': 'export function Button() { return <button/>; }',
    'src/App.tsx': 'import { Button } from "@/Button"; export function App() { return <Button/>; }',
  }));
  const app = graph.nodes.find((n) => n.name === 'App');
  const button = graph.nodes.find((n) => n.name === 'Button');
  assert.ok(app.edges.some((e) => e.kind === 'renders' && e.to === button.id));
});

test('ignores build/dependency trees and honors nested ignore rules', (t) => {
  const graph = analyze(fixture(t, {
    '.gitignore': 'secret.ts\n*.generated.ts\n',
    '.contextbridgeignore': 'private/\n',
    'src/.gitignore': 'ignored.ts\n',
    'src/ok.ts': 'export function ok() {}',
    'src/ignored.ts': 'function no() {}',
    'secret.ts': 'function secret() {}',
    'node_modules/dep/index.js': 'function dep() {}',
    'dist/index.js': 'function built() {}',
    'private/secret.ts': 'function no() {}',
    'schema.generated.ts': 'function generated() {}',
    'types.d.ts': 'declare function declared(): void;',
  }));
  assert.deepEqual(graph.files, ['src/ok.ts']);
});

test('symbol IDs survive line shifts and unrelated file additions', (t) => {
  const root = fixture(t, project);
  const before = analyze(root);
  fs.writeFileSync(path.join(root, 'src/store.ts'), '\n\n' + project['src/store.ts']);
  fs.writeFileSync(path.join(root, 'aaa.ts'), 'export function earlier() {}');
  const after = analyze(root);
  for (const original of before.nodes) assert.equal(after.nodes.find((n) => n.file === original.file && n.name === original.name).id, original.id);
  assert.notEqual(before.snapshot, after.snapshot);
});

test('generated map is deterministic, linked, and escapes hostile comments', (t) => {
  const root = fixture(t, { 'file.ts': '/** <script>alert(1)</script> [link](bad) */\nexport function run() {}' });
  const first = renderMap(analyze(root), { mermaid: true });
  assert.equal(first, renderMap(analyze(root), { mermaid: true }));
  assert.ok(first.includes('```mermaid'));
  assert.ok(!first.includes('<script>'));
  assert.ok(first.includes('&lt;script&gt;'));
});

test('focus includes callers/callees but excludes unrelated symbols and respects budget', (t) => {
  const graph = analyze(fixture(t, project));
  const output = renderFocus(graph, 'findAccount', { depth: 1, maxChars: 4000 });
  assert.ok(output.includes('reset'));
  assert.ok(!output.includes('### src/store.ts :: unused'));
  assert.ok(output.length <= 4000);
  const small = renderFocus(graph, 'src/', { maxChars: 700 });
  assert.ok(small.length <= 700);
  assert.match(small, /omitted by character budget/);
  assert.throws(() => renderFocus(graph, 'does-not-exist'), /No symbols match/);
});

test('init and map preserve hand-written context byte for byte', (t) => {
  const root = fixture(t, { ...project, 'CONTEXT.md': '# My context\r\n\r\nKeep this exact text.\r\n' });
  const before = fs.readFileSync(path.join(root, 'CONTEXT.md'));
  initialize(root);
  refreshMap(root);
  assert.deepEqual(fs.readFileSync(path.join(root, 'CONTEXT.md')), before);
});

test('checkpoint preserves unrelated notes and detects source drift even after map refresh', (t) => {
  const root = fixture(t, project);
  initialize(root);
  fs.appendFileSync(path.join(root, 'CONTEXT.md'), '\n## Personal notes\n\nKeep me.\n');
  checkpoint(root, { goal: 'Reset accounts', current: 'Fix expiry', done: ['Form', 'Email'], next: 'Run auth tests' });
  let context = fs.readFileSync(path.join(root, 'CONTEXT.md'), 'utf8');
  assert.match(context, /Keep me\./);
  assert.match(context, /- Form\n- Email/);
  assert.equal(status(root).context, 'current');
  fs.appendFileSync(path.join(root, 'src/store.ts'), '\nexport const changed = 1;');
  assert.equal(status(root).map, 'stale');
  refreshMap(root);
  const report = status(root);
  assert.equal(report.map, 'current');
  assert.equal(report.context, 'stale');
  context = fs.readFileSync(path.join(root, 'CONTEXT.md'), 'utf8');
  assert.equal((context.match(/context-bridge:checkpoint:start/g) ?? []).length, 1);
});

test('handoff preserves full context, reports freshness, and refuses silent truncation', (t) => {
  const root = fixture(t, project);
  checkpoint(root, { goal: 'Reset accounts', next: 'Test expiry' });
  const output = handoff(root, 'reset', { maxChars: 5000 });
  assert.match(output, /Reset accounts/);
  assert.match(output, /context checkpoint: current/);
  assert.ok(output.length <= 5000);
  assert.throws(() => handoff(root, null, { maxChars: 100 }), /not truncated/);
});

test('refuses unmanaged maps and does not create partial context', (t) => {
  const root = fixture(t, { ...project, 'CODE_MAP.md': '# My handwritten map' });
  assert.throws(() => initialize(root), /not managed/);
  assert.equal(fs.existsSync(path.join(root, 'CONTEXT.md')), false);
  assert.equal(fs.readFileSync(path.join(root, 'CODE_MAP.md'), 'utf8'), '# My handwritten map');
});

test('write lock prevents overlapping writers', (t) => {
  const root = fixture(t, { ...project, '.context-bridge.lock': '123' });
  assert.throws(() => checkpoint(root), /Another Context Bridge write/);
  assert.equal(fs.readFileSync(path.join(root, '.context-bridge.lock'), 'utf8'), '123');
});

test('agent integration is opt-in, additive, and idempotent', (t) => {
  const root = fixture(t, { ...project, 'AGENTS.md': '# Existing rules\nKeep tests passing.\n' });
  initialize(root);
  assert.equal(fs.existsSync(path.join(root, 'CLAUDE.md')), false);
  installAgentInstructions(root);
  const first = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  installAgentInstructions(root);
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), first);
  assert.ok(first.startsWith('# Existing rules\nKeep tests passing.'));
});

test('CLI validates options and reports missing checkpoint as exit 2', (t) => {
  const root = fixture(t, project);
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--root', root], { encoding: 'utf8' });
  assert.equal(run('init').status, 0);
  assert.equal(run('status').status, 2);
  assert.equal(run('checkpoint', '--goal', 'Continue coding').status, 0);
  assert.equal(run('status').status, 0);
  assert.equal(run('focus', 'reset', '--depth', 'nope').status, 1);
  assert.equal(run('map', '--goal', 'Ignored?').status, 1);
  assert.equal(run('unknown').status, 1);
  assert.ok(run('handoff', '--focus', 'reset').stdout.includes('Continue coding'));
});

test('checkpoint captures real Git branch and commit without creating commits', (t) => {
  const root = fixture(t, project);
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'test-branch');
  git('add', '.');
  git('-c', 'user.name=Context Bridge Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'fixture');
  const head = git('rev-parse', 'HEAD');
  checkpoint(root, { goal: 'Keep working' });
  const context = fs.readFileSync(path.join(root, 'CONTEXT.md'), 'utf8');
  assert.ok(context.includes(head));
  assert.ok(context.includes('test-branch'));
  assert.equal(git('rev-parse', 'HEAD'), head);
});

test('syntax errors are surfaced instead of claiming a complete graph', (t) => {
  const graph = analyze(fixture(t, { 'broken.ts': 'export function broken( {' }));
  assert.ok(graph.warnings.length > 0);
  assert.match(renderMap(graph), /Parser warnings/);
});

test('extensionless imports resolve in type=module projects without a tsconfig', (t) => {
  const graph = analyze(fixture(t, { ...project, 'package.json': '{"type":"module"}' }));
  const reset = graph.nodes.find((n) => n.name === 'reset');
  const target = graph.nodes.find((n) => n.name === 'findAccount');
  assert.ok(reset.edges.some((e) => e.kind === 'calls' && e.to === target.id));
});

test('CommonJS require and literal dynamic imports create module edges', (t) => {
  const graph = analyze(fixture(t, {
    'dep.cjs': 'exports.hello = function hello() {};',
    'app.cjs': 'const dep = require("./dep.cjs"); dep.hello(); async function load() { return import("./dep.cjs"); }',
  }));
  const target = graph.nodes.find((n) => n.file === 'dep.cjs' && n.kind === 'module');
  const app = graph.nodes.find((n) => n.file === 'app.cjs' && n.kind === 'module');
  const load = graph.nodes.find((n) => n.name === 'load');
  assert.ok(app.edges.some((e) => e.kind === 'loads' && e.to === target.id));
  assert.ok(load.edges.some((e) => e.kind === 'loads' && e.to === target.id));
});

test('maps 100 functions across 30 files and resolves every link in a chain', (t) => {
  const files = {};
  for (let file = 0; file < 30; file++) {
    const count = file < 10 ? 4 : 3;
    files[`file${file}.ts`] = (file ? `import { fn${file - 1}_0 } from "./file${file - 1}";\n` : '')
      + Array.from({ length: count }, (_, fn) => `/** Demo function. */\nexport function fn${file}_${fn}() { ${file && fn === 0 ? `fn${file - 1}_0();` : ''} }`).join('\n');
  }
  const graph = analyze(fixture(t, files));
  assert.equal(graph.files.length, 30);
  assert.equal(graph.nodes.filter((n) => n.kind === 'function').length, 100);
  assert.equal(graph.nodes.flatMap((n) => n.edges).filter((e) => e.kind === 'calls').length, 29);
});

test('refuses output symlinks without touching the target', (t) => {
  const root = fixture(t, { 'outside.md': 'Do not replace.' });
  try { fs.symlinkSync(path.join(root, 'outside.md'), path.join(root, 'CONTEXT.md')); }
  catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') return t.skip('Symlink creation is unavailable on this host.');
    throw error;
  }
  assert.throws(() => initialize(root), /non-regular file/);
  assert.equal(fs.readFileSync(path.join(root, 'outside.md'), 'utf8'), 'Do not replace.');
});
