import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import ts from 'typescript';
import ignore from 'ignore';

const extensions = /\.(?:[cm]?[jt]s|[jt]sx)$/i;
const excluded = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', '.venv', 'vendor']);
const slash = (value) => value.split(path.sep).join('/');
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');

/** Collect supported source files without traversing symlinks or ignored trees. */
export function collect(root) {
  const files = [];
  const inputs = new Map();
  const extraPath = path.join(root, '.contextbridgeignore');
  const extra = ignore();
  if (fs.existsSync(extraPath)) {
    const text = fs.readFileSync(extraPath, 'utf8');
    inputs.set('.contextbridgeignore', text);
    extra.add(text);
  }
  function walk(dir, rules) {
    const ignorePath = path.join(dir, '.gitignore');
    if (fs.existsSync(ignorePath)) {
      const text = fs.readFileSync(ignorePath, 'utf8');
      inputs.set(slash(path.relative(root, ignorePath)), text);
      rules = [...rules, { base: dir, matcher: ignore().add(text) }];
    }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      if (entry.isSymbolicLink() || excluded.has(entry.name)) continue;
      const absolute = path.join(dir, entry.name);
      const relative = slash(path.relative(root, absolute));
      const suffix = entry.isDirectory() ? '/' : '';
      let ignored = false;
      for (const rule of rules) {
        const result = rule.matcher.test(slash(path.relative(rule.base, absolute)) + suffix);
        if (result.ignored) ignored = true;
        if (result.unignored) ignored = false;
      }
      if (ignored || extra.ignores(relative + suffix)) continue;
      if (entry.isDirectory()) walk(absolute, rules);
      else if (entry.isFile() && extensions.test(entry.name) && !/\.d\.[cm]?ts$/.test(entry.name)) {
        files.push(relative);
        inputs.set(relative, fs.readFileSync(absolute, 'utf8'));
      } else if (entry.isFile() && /^(?:tsconfig.*\.json|jsconfig\.json|package\.json)$/.test(entry.name)) {
        inputs.set(relative, fs.readFileSync(absolute, 'utf8'));
      }
    }
  }
  walk(root, []);
  const hash = crypto.createHash('sha256');
  for (const [name, text] of [...inputs].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
    hash.update(JSON.stringify([name, text]));
  }
  return { files: files.sort(), inputs, snapshot: hash.digest('hex') };
}

function isFunction(node) {
  return (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) && !!node.body;
}

function label(node, sf) {
  if (ts.isConstructorDeclaration(node)) return 'constructor';
  if (node.name) return node.name.getText(sf);
  const parent = node.parent;
  if (ts.isVariableDeclaration(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent)) {
    return parent.name.getText(sf);
  }
  if (ts.isBinaryExpression(parent) && parent.right === node) return parent.left.getText(sf);
  if (node.modifiers?.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword)) return 'default';
  return '<anonymous>';
}

function purpose(node, checker) {
  const candidates = [node];
  let parent = node.parent;
  while (parent && (ts.isVariableDeclaration(parent) || ts.isVariableDeclarationList(parent)
    || ts.isVariableStatement(parent) || ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent))) {
    candidates.push(parent);
    parent = parent.parent;
  }
  for (const candidate of candidates.filter(Boolean)) {
    for (const doc of candidate.jsDoc ?? []) {
      if (typeof doc.comment === 'string') return { text: doc.comment.replace(/\s+/g, ' ').trim().slice(0, 300), source: 'JSDoc' };
    }
  }
  const symbol = node.name && checker.getSymbolAtLocation(node.name);
  const text = symbol && ts.displayPartsToString(symbol.getDocumentationComment(checker));
  return text ? { text: text.replace(/\s+/g, ' ').slice(0, 300), source: 'JSDoc' }
    : { text: 'Undocumented; inspect the implementation before inferring intent.', source: 'unknown' };
}

/** Build a static symbol graph using TypeScript's parser and type checker. No project code is executed. */
export function analyze(directory) {
  const root = fs.realpathSync(directory);
  const collected = collect(root);
  const warnings = [];
  const options = {
    allowJs: true, checkJs: true, noEmit: true, skipLibCheck: true,
    target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler, jsx: ts.JsxEmit.Preserve,
  };
  for (const name of ['tsconfig.json', 'jsconfig.json']) {
    const configPath = path.join(root, name);
    if (!fs.existsSync(configPath)) continue;
    const read = ts.readConfigFile(configPath, ts.sys.readFile);
    if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'));
    const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, root);
    const errors = parsed.errors.filter((e) => e.code !== 18003);
    if (errors.length) throw new Error(errors.map((e) => ts.flattenDiagnosticMessageText(e.messageText, '\n')).join('\n'));
    Object.assign(options, parsed.options, { allowJs: true, noEmit: true });
    break;
  }
  const program = ts.createProgram(collected.files.map((name) => path.join(root, name)), options);
  const checker = program.getTypeChecker();
  const sourceFiles = collected.files.map((name) => program.getSourceFile(path.join(root, name))).filter(Boolean);
  const nodes = [];
  const byDeclaration = new Map();
  const fileNodes = new Map();
  const ids = new Map();
  function register(sf, declaration, name, kind) {
    const file = slash(path.relative(root, sf.fileName));
    const key = `${file}::${name}`;
    const count = (ids.get(key) ?? 0) + 1;
    ids.set(key, count);
    const qualified = count === 1 ? name : `${name}~${count}`;
    const node = {
      id: `n${digest(`${file}::${qualified}`).slice(0, 16)}`, file, name: qualified, kind,
      line: sf.getLineAndCharacterOfPosition(declaration.getStart(sf)).line + 1,
      purpose: kind === 'module' ? { text: 'Module imports, exports, and top-level execution.', source: 'structural' } : purpose(declaration, checker),
      edges: [], unresolved: [],
    };
    nodes.push(node);
    byDeclaration.set(declaration, node);
    return node;
  }
  for (const sf of sourceFiles) {
    for (const diagnostic of program.getSyntacticDiagnostics(sf)) {
      warnings.push(`${slash(path.relative(root, sf.fileName))}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
    }
    fileNodes.set(path.resolve(sf.fileName), register(sf, sf, '<module>', 'module'));
    function visit(node, scope = [], owner = fileNodes.get(path.resolve(sf.fileName))) {
      let nextScope = scope;
      let nextOwner = owner;
      if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
        const className = node.name?.getText(sf) ?? (node.parent.name?.getText(sf)) ?? '<class>';
        nextOwner = register(sf, node, [...scope, className].join('.'), 'class');
        nextScope = [...scope, className];
      } else if (isFunction(node)) {
        const name = label(node, sf);
        nextOwner = register(sf, node, [...scope, name].join('.'), 'function');
        nextScope = [...scope, name];
      }
      if (nextOwner !== owner) owner.edges.push({ to: nextOwner.id, kind: 'contains' });
      ts.forEachChild(node, (child) => visit(child, nextScope, nextOwner));
    }
    ts.forEachChild(sf, (node) => visit(node));
  }
  function fromDeclaration(declaration) {
    if (!declaration) return undefined;
    if (byDeclaration.has(declaration)) return byDeclaration.get(declaration);
    if (declaration.initializer && byDeclaration.has(declaration.initializer)) return byDeclaration.get(declaration.initializer);
    return undefined;
  }
  function symbolTargets(expression) {
    let symbol = checker.getSymbolAtLocation(expression);
    if (!symbol && ts.isPropertyAccessExpression(expression)) symbol = checker.getSymbolAtLocation(expression.name);
    if (symbol?.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol);
    return (symbol?.declarations ?? []).map(fromDeclaration).filter(Boolean);
  }
  function connect(source, target, kind) {
    if (!source.edges.some((edge) => edge.to === target.id && edge.kind === kind)) source.edges.push({ to: target.id, kind });
  }
  function moduleTarget(specifier, sf) {
    const resolved = ts.resolveModuleName(specifier, sf.fileName, options, ts.sys).resolvedModule;
    return resolved && fileNodes.get(path.resolve(resolved.resolvedFileName));
  }
  for (const sf of sourceFiles) {
    const moduleNode = fileNodes.get(path.resolve(sf.fileName));
    function visit(node, owner) {
      const current = byDeclaration.get(node) ?? owner;
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const target = moduleTarget(node.moduleSpecifier.text, sf);
        if (target) connect(moduleNode, target, ts.isImportDeclaration(node) ? 'imports' : 'reexports');
        else moduleNode.unresolved.push(`module: ${node.moduleSpecifier.text}`);
      }
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        const text = node.expression.getText(sf).replace(/\s+/g, ' ').slice(0, 120);
        const isLoad = ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || text === 'require');
        if (isLoad && node.arguments?.[0] && ts.isStringLiteral(node.arguments[0])) {
          const target = moduleTarget(node.arguments[0].text, sf);
          if (target) connect(current, target, 'loads');
          else current.unresolved.push(`module: ${node.arguments[0].text}`);
        } else {
          const signature = checker.getResolvedSignature(node);
          const targets = [...new Set([fromDeclaration(signature?.declaration), ...symbolTargets(node.expression)].filter(Boolean))];
          for (const target of targets) connect(current, target, ts.isNewExpression(node) ? 'constructs' : 'calls');
          if (!targets.length) current.unresolved.push(text);
        }
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        for (const target of symbolTargets(node.tagName)) connect(current, target, 'renders');
      }
      // A reference is not evidence that a callback actually runs.
      if (ts.isIdentifier(node)) {
        const p = node.parent;
        const isDeclarationName = p.name === node && !ts.isPropertyAccessExpression(p);
        const isCallTarget = (ts.isCallExpression(p) || ts.isNewExpression(p)) && p.expression === node;
        const isProperty = ts.isPropertyAccessExpression(p) && p.name === node;
        const propertyCalled = isProperty && (ts.isCallExpression(p.parent) || ts.isNewExpression(p.parent)) && p.parent.expression === p;
        if (!isDeclarationName && !isCallTarget && !propertyCalled && !ts.isImportSpecifier(p) && !ts.isExportSpecifier(p)) {
          for (const target of symbolTargets(node)) if (target.id !== current.id) connect(current, target, 'references');
        }
      }
      ts.forEachChild(node, (child) => visit(child, current));
    }
    ts.forEachChild(sf, (node) => visit(node, moduleNode));
  }
  for (const node of nodes) {
    node.edges.sort((a, b) => `${a.kind}:${a.to}`.localeCompare(`${b.kind}:${b.to}`, 'en'));
    node.unresolved = [...new Set(node.unresolved)].sort();
  }
  // Hash the actual compiler inputs too: imported types and inherited configs can affect resolution.
  const hash = crypto.createHash('sha256').update(collected.snapshot);
  hash.update(ts.version);
  hash.update(JSON.stringify(options, (key, value) => key === 'configFile' ? undefined : value));
  for (const sf of [...program.getSourceFiles()].sort((a, b) => a.fileName.localeCompare(b.fileName, 'en'))) {
    hash.update(JSON.stringify([slash(path.relative(root, sf.fileName)), sf.text]));
  }
  return { version: 1, snapshot: hash.digest('hex'), files: collected.files, nodes, warnings };
}
