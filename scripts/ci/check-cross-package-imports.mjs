#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tracePackageClosure } from '../../apps/shell/resources/scripts/cross-package-closure.mjs';

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const codeFile = /\.(?:mjs|js|cjs)$/;
const sourceDirectories = ['src', 'bin', 'lib'];

function inside(directory, file) {
  const relative = path.relative(directory, file);
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// This check runs before shell dependencies are installed. Keep its JS/TS scan
// self-contained: strings, comments, regexes and whole template literals are opaque.
function sourceTokens(source) {
  const tokens = [];
  let i = 0;
  let line = 1;
  const advance = end => {
    for (; i < end; i += 1) if (source[i] === '\n') line += 1;
  };
  const quoted = (start, quote) => {
    let end = start + 1;
    while (end < source.length) {
      if (source[end] === '\\') { end += 2; continue; }
      if (source[end++] === quote) break;
    }
    return end;
  };
  const template = start => {
    let end = start + 1;
    while (end < source.length) {
      if (source[end] === '\\') { end += 2; continue; }
      if (source[end] === '`') return end + 1;
      if (source[end] === '$' && source[end + 1] === '{') {
        end += 2;
        let braces = 1;
        while (end < source.length && braces) {
          if (source[end] === '\'' || source[end] === '"') { end = quoted(end, source[end]); continue; }
          if (source[end] === '`') { end = template(end); continue; }
          if (source[end] === '{') braces += 1;
          if (source[end] === '}') braces -= 1;
          end += 1;
        }
        continue;
      }
      end += 1;
    }
    return end;
  };
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) { advance(i + 1); continue; }
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i + 2);
      advance(end < 0 ? source.length : end);
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      advance(end < 0 ? source.length : end + 2);
      continue;
    }
    if (char === '\'' || char === '"') {
      const end = quoted(i, char);
      tokens.push({ value: source.slice(i + 1, end - 1), kind: 'string', line });
      advance(end);
      continue;
    }
    if (char === '`') { advance(template(i)); continue; }
    if (char === '/' && /^(?:[=(:,;[{!?:]|return|case|throw|=>)$/.test(tokens.at(-1)?.value ?? '=')) {
      let end = i + 1;
      let characterClass = false;
      while (end < source.length && source[end] !== '\n') {
        if (source[end] === '\\') { end += 2; continue; }
        if (source[end] === '[') characterClass = true;
        if (source[end] === ']') characterClass = false;
        if (source[end++] === '/' && !characterClass) break;
      }
      while (/[a-z]/i.test(source[end] ?? '')) end += 1;
      advance(end);
      continue;
    }
    const identifier = /^[A-Za-z_$][\w$]*/.exec(source.slice(i));
    const value = identifier?.[0] ?? (source.startsWith('=>', i) ? '=>' : char);
    tokens.push({ value, kind: identifier ? 'word' : 'punctuation', line });
    advance(i + value.length);
  }
  return tokens;
}

function tokenPairs(tokens) {
  const pairs = new Map();
  const stack = [];
  const closing = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < tokens.length; i += 1) {
    const value = tokens[i].value;
    if (['(', '[', '{'].includes(value)) stack.push(i);
    else if (closing[value] && tokens[stack.at(-1)]?.value === closing[value]) {
      const open = stack.pop();
      pairs.set(open, i);
      pairs.set(i, open);
    }
  }
  return pairs;
}

function staticImports(source) {
  const tokens = sourceTokens(source);
  const found = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const keyword = tokens[i].value;
    if ((keyword === 'require' || keyword === 'import') && tokens[i + 1]?.value === '('
      && tokens[i + 2]?.kind === 'string') {
      found.push(tokens[i + 2].value);
    } else if (keyword === 'import' && tokens[i + 1]?.kind === 'string') {
      found.push(tokens[i + 1].value);
    } else if ((keyword === 'import' || keyword === 'export') && tokens[i + 1]?.value !== 'type') {
      for (let j = i + 1; j < tokens.length && j < i + 100; j += 1) {
        if (tokens[j].value === ';' || ['import', 'export'].includes(tokens[j].value)) break;
        if (tokens[j].value === 'from' && tokens[j + 1]?.kind === 'string') {
          found.push(tokens[j + 1].value);
          break;
        }
      }
    }
  }
  return found;
}

function topLevelAwaitLines(source) {
  const tokens = sourceTokens(source);
  const pairs = tokenPairs(tokens);
  const functionBodies = [];
  const conciseArrows = [];
  const controls = new Set(['if', 'for', 'while', 'switch', 'catch', 'with']);
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i].value === 'function') {
      const parameters = tokens.findIndex((token, index) => index > i && token.value === '(');
      const close = pairs.get(parameters);
      if (close !== undefined) {
        const body = tokens.findIndex((token, index) => index > close && token.value === '{');
        if (body >= 0 && pairs.has(body)) functionBodies.push([body, pairs.get(body)]);
      }
    }
    if (tokens[i].value === '=>' && tokens[i + 1]?.value === '{' && pairs.has(i + 1)) {
      functionBodies.push([i + 1, pairs.get(i + 1)]);
    } else if (tokens[i].value === '=>') {
      let end = tokens.length;
      let depth = 0;
      for (let j = i + 1; j < tokens.length; j += 1) {
        const value = tokens[j].value;
        if (depth === 0 && [',', ';', ')', ']', '}'].includes(value)) { end = j; break; }
        if (['(', '[', '{'].includes(value)) depth += 1;
        if ([')', ']', '}'].includes(value)) depth -= 1;
      }
      conciseArrows.push([i, end]);
    }
    if (tokens[i].value === '{' && tokens[i - 1]?.value === ')') {
      const open = pairs.get(i - 1);
      const leader = tokens[open - 1]?.value;
      if (open !== undefined && !controls.has(leader) && pairs.has(i)) {
        functionBodies.push([i, pairs.get(i)]);
      }
    }
  }
  return [...new Set(tokens.flatMap((token, index) => token.value === 'await'
    && tokens[index - 1]?.value !== '.' && tokens[index + 1]?.value !== ':'
    && !functionBodies.some(([start, end]) => start < index && index < end)
    && !conciseArrows.some(([start, end]) => start < index && index < end)
    ? [token.line] : []))];
}

function packageEntries(root) {
  const entries = new Map();
  for (const name of readdirSync(path.join(root, 'packages'))) {
    const directory = path.join(root, 'packages', name);
    const manifest = path.join(directory, 'package.json');
    if (!existsSync(manifest)) continue;
    const metadata = JSON.parse(readFileSync(manifest, 'utf8'));
    if (metadata.name) entries.set(metadata.name, { directory, metadata });
  }
  return entries;
}

function exportPaths(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(exportPaths);
  if (!value || typeof value !== 'object') return [];
  return ['import', 'require', 'node', 'default'].flatMap(key => exportPaths(value[key]));
}

function resolvedFile(base) {
  return [base, `${base}.ts`, `${base}.tsx`, `${base}.js`, `${base}.mjs`, `${base}.cjs`,
    path.join(base, 'index.ts'), path.join(base, 'index.js')].find(candidate =>
    existsSync(candidate) && statSync(candidate).isFile());
}

function resolvePackageImport(specifier, entries) {
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];
  const entry = entries.get(name);
  if (!entry) return null;
  const subpath = specifier.slice(name.length).replace(/^\//, '');
  const key = subpath ? `./${subpath}` : '.';
  const exports = entry.metadata.exports;
  let target = exports?.[key];
  if (target === undefined && exports && typeof exports === 'object') {
    for (const [pattern, value] of Object.entries(exports)) {
      const star = pattern.indexOf('*');
      if (star < 0) continue;
      const prefix = pattern.slice(0, star);
      const suffix = pattern.slice(star + 1);
      if (key.startsWith(prefix) && key.endsWith(suffix)) {
        const matched = key.slice(prefix.length, key.length - suffix.length);
        target = exportPaths(value).map(item => item.replace('*', matched));
        break;
      }
    }
  }
  if (target === undefined && !subpath) target = exports && !Object.keys(exports).some(item => item.startsWith('.'))
    ? exports : entry.metadata.main ?? './index.js';
  const candidates = target === undefined ? [`./${subpath}`] : exportPaths(target);
  for (const candidate of candidates) {
    const base = path.resolve(entry.directory, candidate);
    if (!inside(entry.directory, base)) continue;
    const file = resolvedFile(base);
    if (file) return file;
  }
  return null;
}

function backendPackageRoots(root) {
  const packagesRoot = path.join(root, 'packages');
  const shellRoot = path.join(root, 'apps/shell');
  const entries = packageEntries(root);
  const roots = new Set();
  const extensions = path.join(root, 'apps/shell/extensions');
  if (!existsSync(extensions)) return [];
  const pending = [];
  for (const extension of readdirSync(extensions)) {
    const nodeDirectory = path.join(extensions, extension, 'src/node');
    for (const file of codeFiles(nodeDirectory, /\.(?:ts|js|mjs|cjs)$/)) {
      if (!/\.test\.[cm]?[jt]s$/.test(file)) pending.push(file);
    }
  }
  const visited = new Set();
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    for (const specifier of staticImports(readFileSync(file, 'utf8'))) {
      let resolved;
      if (specifier.startsWith('.')) {
        const base = path.resolve(path.dirname(file), specifier);
        resolved = resolvedFile(base);
      } else if (specifier.startsWith('@akari-video/') || specifier.startsWith('akari-video/')) {
        resolved = resolvePackageImport(specifier, entries);
      }
      if (resolved) {
        const real = realpathSync(resolved);
        if (inside(packagesRoot, real)) roots.add(real);
        else if (inside(shellRoot, real) && /\.(?:ts|tsx|js|mjs|cjs)$/.test(real)) pending.push(real);
      }
    }
  }
  return [...roots];
}

async function backendAwaitViolations(root) {
  const packagesRoot = path.join(root, 'packages');
  const roots = backendPackageRoots(root);
  const { files } = await tracePackageClosure({
    roots,
    packagesRoot,
    readFile: file => readFileSync(file, 'utf8'),
    isFile: file => existsSync(file) && statSync(file).isFile(),
    isDirectory: file => existsSync(file) && statSync(file).isDirectory()
  });
  return files.flatMap(file => /\.(?:js|mjs|cjs)$/.test(file)
    ? topLevelAwaitLines(readFileSync(file, 'utf8'))
      .map(line => `${path.relative(root, file)}:${line}: top-level await in shell backend dependency`)
    : []);
}

function packageName(root, source) {
  const relative = path.relative(path.join(root, 'packages'), source);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
  const name = relative.split(path.sep)[0];
  return name && name !== '.' ? name : null;
}

async function distributedPackages(root) {
  const shell = JSON.parse(readFileSync(path.join(root, 'apps/shell/package.json'), 'utf8'));
  const names = new Set();
  for (const entry of shell.build?.extraResources ?? []) {
    if (typeof entry.from !== 'string' || !/^packages\//.test(entry.to ?? '')) continue;
    const name = packageName(root, path.resolve(root, 'apps/shell', entry.from));
    if (name) names.add(name);
  }

  const vendorFile = path.join(root, 'packages/akari-launcher/src/vendor-sources.mjs');
  const { VENDOR_SOURCES } = await import(pathToFileURL(vendorFile).href);
  if (!Array.isArray(VENDOR_SOURCES) || VENDOR_SOURCES.some(source => typeof source !== 'string')) {
    throw new Error('VENDOR_SOURCES must be an array of paths');
  }
  for (const source of VENDOR_SOURCES) {
    if (!source.startsWith('packages/')) continue;
    const name = packageName(root, path.resolve(root, source));
    if (name) names.add(name);
  }
  return [...names].sort();
}

function* codeFiles(directory, pattern = codeFile) {
  if (!existsSync(directory)) return;
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) yield* codeFiles(file, pattern);
    else if (entry.isFile() && pattern.test(entry.name)) yield file;
  }
}

// Tokenize enough JavaScript to ignore comments and strings that merely mention imports.
// Keep string tokens so the actual module specifier can be checked without dependencies.
export function crossPackageImports(source) {
  const tokens = [...source.matchAll(/\/\/[^\r\n]*|\/\*[\s\S]*?\*\/|'(?:\\[\s\S]|[^'\\])*'|"(?:\\[\s\S]|[^"\\])*"|`(?:\\[\s\S]|[^`\\])*`|[\w$]+|[^\s]/g)]
    .filter(match => !match[0].startsWith('//') && !match[0].startsWith('/*'));
  const found = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const keyword = tokens[i][0];
    if (!['import', 'export', 'require'].includes(keyword)
      || (keyword !== 'require' && tokens[i - 1]?.[0] === '.')) continue;
    let specifier;
    if (tokens[i + 1]?.[0] === '(' && keyword !== 'export') {
      if (tokens[i + 3]?.[0] === ')' || tokens[i + 3]?.[0] === ',') specifier = tokens[i + 2];
    } else if (keyword === 'import' && /^['"`]/.test(tokens[i + 1]?.[0] ?? '')) {
      specifier = tokens[i + 1];
    } else if (keyword !== 'require' && tokens[i + 1]?.[0] !== '.') {
      for (let j = i + 1; j < tokens.length && j < i + 100 && tokens[j][0] !== ';'; j += 1) {
        if (tokens[j][0] === 'from') {
          specifier = tokens[j + 1];
          break;
        }
      }
    }
    if (!specifier || !/^['"`]/.test(specifier[0])) continue;
    const value = specifier[0].slice(1, -1);
    if (!value.startsWith('@akari-video/')) continue;
    found.push({ specifier: value, line: source.slice(0, tokens[i].index).split(/\r\n|\r|\n/).length });
  }
  return found;
}

async function main(args) {
  let root = defaultRoot;
  if (args.length) {
    if (args.length !== 2 || args[0] !== '--root' || !args[1]) throw new Error('usage: check-cross-package-imports.mjs [--root <directory>]');
    root = realpathSync(path.resolve(args[1]));
  }
  const names = await distributedPackages(root);
  const violations = [];
  let files = 0;
  for (const name of names) {
    const packageRoot = path.join(root, 'packages', name);
    if (!existsSync(packageRoot)) throw new Error(`distributed package is missing: packages/${name}`);
    for (const directory of sourceDirectories) {
      for (const file of codeFiles(path.join(packageRoot, directory))) {
        files += 1;
        for (const found of crossPackageImports(readFileSync(file, 'utf8'))) {
          violations.push(`${path.relative(root, file)}:${found.line}: ${found.specifier}`);
        }
      }
    }
  }
  violations.push(...await backendAwaitViolations(root));
  if (violations.length) {
    for (const violation of violations) process.stderr.write(`[cross-package-imports] ${violation}\n`);
    process.exitCode = 1;
  } else {
    process.stdout.write(`[cross-package-imports] OK: ${names.length} packages, ${files} files\n`);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`[cross-package-imports] ${error.message}\n`);
    process.exitCode = 1;
  });
}
