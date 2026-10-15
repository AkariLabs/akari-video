#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const schemaFile = fileURLToPath(new URL('../project-manifest.schema.json', import.meta.url));
const schema = JSON.parse(fs.readFileSync(schemaFile, 'utf8'));
const validate = new Ajv2020({ strict: false, allErrors: true }).compile(schema);

export function validateProjectManifest(value) {
  const errors = [];
  if (!validate(value)) errors.push(...validate.errors.map(error => ({ code: 'SCHEMA', message: `${error.instancePath || '/'} ${error.message}` })));
  if (errors.length) return errors;
  const ids = new Set();
  for (const node of value.nodes) {
    if (ids.has(node.id)) errors.push({ code: 'DUPLICATE_NODE', message: node.id });
    ids.add(node.id);
  }
  const edges = new Set();
  const adjacency = new Map();
  for (const edge of value.edges) {
    const key = `${edge.from}\0${edge.uses}`;
    if (edges.has(key)) errors.push({ code: 'DUPLICATE_EDGE', message: `${edge.from} → ${edge.uses}` });
    edges.add(key);
    if (!ids.has(edge.from) || !ids.has(edge.uses)) errors.push({ code: 'MISSING_NODE', message: `${edge.from} → ${edge.uses}` });
    if (edge.from === edge.uses) errors.push({ code: 'SELF_REFERENCE', message: edge.from });
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    adjacency.get(edge.from).push(edge.uses);
  }
  const colors = new Map();
  function visit(id) {
    colors.set(id, 1);
    for (const next of adjacency.get(id) ?? []) {
      if (colors.get(next) === 1 && next !== id) errors.push({ code: 'CYCLE', message: `${id} → ${next}` });
      else if (!colors.has(next)) visit(next);
    }
    colors.set(id, 2);
  }
  for (const id of ids) if (!colors.has(id)) visit(id);
  return errors;
}

const entry = process.argv[1] && fs.existsSync(process.argv[1])
  && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
if (entry) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: validate-project-manifest <project-root or manifest.json> [--json]');
  } else if (args.length < 1 || args.length > 2 || (args.length === 2 && args[1] !== '--json')) {
    console.error('Usage: validate-project-manifest <project-root or manifest.json> [--json]');
    process.exitCode = 2;
  } else {
    let file = path.resolve(args[0]);
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, '.akari', 'manifest.json');
    let errors;
    try { errors = validateProjectManifest(JSON.parse(fs.readFileSync(file, 'utf8'))); }
    catch (error) { errors = [{ code: 'IO', message: error.message }]; }
    const result = { ok: !errors.length, file, errors };
    if (args.includes('--json')) console.log(JSON.stringify(result));
    else {
      console.log(`${result.ok ? 'OK' : 'NG'}: ${file}`);
      for (const error of errors) console.error(`[${error.code}] ${error.message}`);
    }
    process.exitCode = result.ok ? 0 : 1;
  }
}
