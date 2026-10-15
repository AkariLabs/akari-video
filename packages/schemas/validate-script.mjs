#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(await fs.readFile(path.join(here, 'script.schema.json'), 'utf8'));
const check = new Ajv2020({ allErrors: true, strict: false }).compile(schema);

export function validateScript(value) {
  const errors = [];
  if (!check(value)) errors.push(...check.errors.map(error => `${error.instancePath || '/'} ${error.message}`));
  if (Array.isArray(value?.lines)) {
    const seen = new Set();
    value.lines.forEach((line, index) => {
      if (typeof line?.id !== 'string') return;
      if (seen.has(line.id)) errors.push(`/lines/${index}/id must be unique`);
      seen.add(line.id);
    });
  }
  return { ok: errors.length === 0, errors };
}

/** Tolerant reader: unknown fields survive; malformed and duplicate lines are skipped. */
export function readScript(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const seen = new Set();
  const lines = (Array.isArray(source.lines) ? source.lines : []).filter(line => {
    if (!line || typeof line !== 'object' || Array.isArray(line)) return false;
    if (typeof line.id !== 'string' || !line.id || seen.has(line.id)) return false;
    if (line.kind !== 'plan' && line.kind !== 'memo') return false;
    if (typeof line.at !== 'number' || !Number.isFinite(line.at) || line.at < 0) return false;
    if (typeof line.text !== 'string' || line.text.length < 1 || line.text.length > 500) return false;
    if (line.duration !== undefined && (typeof line.duration !== 'number' || !Number.isFinite(line.duration) || line.duration <= 0)) return false;
    if (line.done !== undefined && typeof line.done !== 'boolean') return false;
    if (line.author !== undefined && !['user', 'ai', 'playbook'].includes(line.author)) return false;
    if (line.placeholder !== undefined && typeof line.placeholder !== 'string') return false;
    if (line.beat !== undefined && typeof line.beat !== 'string') return false;
    seen.add(line.id);
    return true;
  }).sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { ...source, version: 0, kind: 'akari-script', lines };
}

if (process.argv[1] && await fs.realpath(path.resolve(process.argv[1])).catch(() => '') === await fs.realpath(fileURLToPath(import.meta.url))) {
  if (!process.argv[2]) { console.error('Usage: node packages/schemas/validate-script.mjs <script.json>'); process.exitCode = 2; }
  else {
    try {
      const result = validateScript(JSON.parse(await fs.readFile(process.argv[2], 'utf8')));
      if (result.ok) console.log(`OK: ${process.argv[2]}`);
      else { for (const error of result.errors) console.error(`ERROR: ${error}`); process.exitCode = 1; }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
