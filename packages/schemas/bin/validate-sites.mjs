#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.resolve(process.argv[2] ?? fileURLToPath(new URL('../../../catalog', import.meta.url)));
const schema = JSON.parse(fs.readFileSync(new URL('../site.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const files = fs.readdirSync(path.join(root, 'sites')).filter(name => name.endsWith('.json'));
const errors = [];
for (const file of files) {
  let site;
  try { site = JSON.parse(fs.readFileSync(path.join(root, 'sites', file), 'utf8')); }
  catch (error) { errors.push(`${file}: ${error}`); continue; }
  if (!validate(site)) errors.push(`${file}: ${JSON.stringify(validate.errors)}`);
  if (site.id !== file.slice(0, -5)) errors.push(`${file}: id とファイル名が違います`);
  if (Array.isArray(site.hosts) && typeof site.entry_url === 'string') {
    try { if (!site.hosts.includes(new URL(site.entry_url).hostname)) errors.push(`${file}: entry_url が hosts 外です`); }
    catch { errors.push(`${file}: entry_url が不正です`); }
  }
  for (const reference of Array.isArray(site.recommendations) ? site.recommendations : []) {
    if (reference.startsWith('audio/candidates/')) {
      const id = reference.slice('audio/candidates/'.length);
      const candidates = JSON.parse(fs.readFileSync(path.join(root, 'audio/candidates.json'), 'utf8'));
      if (!candidates.categories.some(group => group.items.some(item => item.id === id))) errors.push(`${file}: おすすめが見つかりません: ${reference}`);
    } else if (!fs.existsSync(path.join(root, reference, 'meta.json'))) errors.push(`${file}: おすすめが見つかりません: ${reference}`);
  }
}
if (errors.length) { for (const error of errors) console.error(error); process.exit(1); }
console.log(`OK: ${files.length} sites`);
