#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(await fs.readFile(path.join(root, 'akari-recipe.schema.json'), 'utf8'));
export const capabilities = JSON.parse(await fs.readFile(path.join(root, 'capabilities.json'), 'utf8'));
const capabilitySet = new Set(capabilities);
let checkSchema;
try {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  checkSchema = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !/(?:package|module) 'ajv(?:\/dist\/2020\.js)?'/u.test(error.message)) throw error;
}

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function basicErrors(value) {
  if (!isObject(value)) return ['/ must be object'];
  const errors = [];
  for (const key of schema.required) if (!Object.hasOwn(value, key)) errors.push(`/ must have required property '${key}'`);
  if (value.version !== undefined && value.version !== 0) errors.push('/version must be 0');
  if (value.kind !== undefined && value.kind !== 'akari-recipe') errors.push('/kind must be akari-recipe');
  if (value.id !== undefined && (typeof value.id !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.id))) errors.push('/id must be a slug');
  if (value.name !== undefined && (typeof value.name !== 'string' || value.name.length === 0)) errors.push('/name must be a nonempty string');
  for (const key of ['needs', 'outputs', 'gates']) if (value[key] !== undefined && !Array.isArray(value[key])) errors.push(`/${key} must be array`);
  if (value.inputs !== undefined && !isObject(value.inputs)) errors.push('/inputs must be object');
  if (value.checkpoint !== undefined && typeof value.checkpoint !== 'string') errors.push('/checkpoint must be string');
  if (Array.isArray(value.outputs) && value.outputs.some(item => !isObject(item))) errors.push('/outputs items must be object');
  if (Array.isArray(value.needs) && (value.needs.some(item => typeof item !== 'string') || new Set(value.needs).size !== value.needs.length)) errors.push('/needs must contain unique strings');
  if (Array.isArray(value.gates) && (value.gates.some(item => !schema.properties.gates.items.enum.includes(item)) || new Set(value.gates).size !== value.gates.length)) errors.push('/gates contains an invalid or duplicate gate');
  return errors;
}

export function validateAkariRecipe(value) {
  const errors = checkSchema
    ? (checkSchema(value) ? [] : checkSchema.errors.map(error => `${error.instancePath || '/'} ${error.message}`))
    : basicErrors(value);
  if (Array.isArray(value?.needs)) for (const [index, need] of value.needs.entries()) {
    if (!capabilitySet.has(need)) errors.push(`/needs/${index} is not a capability: ${need}`);
  }
  return { ok: errors.length === 0, errors };
}

export async function validateAkariRecipeFile(file) {
  return validateAkariRecipe(JSON.parse(await fs.readFile(file, 'utf8')));
}

if (process.argv[1] && await fs.realpath(path.resolve(process.argv[1])).catch(() => '') === await fs.realpath(fileURLToPath(import.meta.url))) {
  const file = process.argv[2];
  if (!file) { console.error('Usage: validate-akari-recipe <recipe.json>'); process.exitCode = 2; }
  else {
    try {
      const result = await validateAkariRecipeFile(path.resolve(file));
      if (result.ok) console.log(`OK: ${file}`);
      else { for (const error of result.errors) console.error(`ERROR: ${error}`); process.exitCode = 1; }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
