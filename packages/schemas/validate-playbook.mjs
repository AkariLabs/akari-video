#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(await fs.readFile(path.join(root, 'playbook.schema.json'), 'utf8'));
const checkSchema = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const headings = ['目的とできあがり', '流れ', '設定値', '必要な素材（仮枠）', '使った部品', '要る道具', 'ライセンス', '出どころ'];

export async function validatePlaybook(playbook, { markdown, skillsDir = path.resolve(root, '../../skills') } = {}) {
  const errors = [];
  const warnings = [];
  if (!checkSchema(playbook)) {
    errors.push(...checkSchema.errors.map(error => `${error.instancePath || '/'} ${error.message}`));
  }
  for (const previewPath of [playbook?.preview?.cover, ...(Array.isArray(playbook?.preview?.frames) ? playbook.preview.frames : [])]) {
    if (typeof previewPath !== 'string') continue;
    if (!previewPath || path.isAbsolute(previewPath) || /^[a-zA-Z]:[\\/]/.test(previewPath)
      || previewPath.includes('..') || previewPath.startsWith('\\\\')) {
      errors.push(`preview のパスは playbook.json からの相対パスで、.. を含められません: ${previewPath}`);
    }
  }
  for (const [index, item] of (Array.isArray(playbook?.placeholders) ? playbook.placeholders : []).entries()) {
    if (['own', 'site'].includes(item?.sample?.source)) errors.push(`placeholders[${index}].sample に own / site は使えません`);
  }
  for (const [index, item] of (Array.isArray(playbook?.parts) ? playbook.parts : []).entries()) {
    if (['own', 'site'].includes(item?.source)) errors.push(`parts[${index}] に own / site は使えません`);
  }
  const skillNames = new Set([...(Array.isArray(playbook?.steps) ? playbook.steps.map(step => step?.skill) : []),
    ...(Array.isArray(playbook?.requires?.skills) ? playbook.requires.skills : [])].filter(Boolean));
  for (const skill of skillNames) {
    try { await fs.access(path.join(skillsDir, skill, 'SKILL.md')); }
    catch { warnings.push(`スキルが見つかりません: ${skill}`); }
  }
  if (markdown !== undefined) {
    const found = [...markdown.matchAll(/^## (.+?)\s*$/gmu)].map(match => match[1].trim());
    for (const heading of headings) if (!found.includes(heading)) errors.push(`playbook.md に見出しがありません: ${heading}`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

export async function validatePlaybookFiles(jsonPath, markdownPath = path.join(path.dirname(jsonPath), 'playbook.md')) {
  const playbook = JSON.parse(await fs.readFile(jsonPath, 'utf8'));
  const markdown = await fs.readFile(markdownPath, 'utf8');
  return validatePlaybook(playbook, { markdown });
}

if (process.argv[1] && await fs.realpath(path.resolve(process.argv[1])).catch(() => '') === await fs.realpath(fileURLToPath(import.meta.url))) {
  const jsonPath = process.argv[2];
  if (!jsonPath) {
    console.error('使い方: node packages/schemas/validate-playbook.mjs <playbook.json> [playbook.md]');
    process.exitCode = 2;
  } else {
    try {
      const result = await validatePlaybookFiles(path.resolve(jsonPath), process.argv[3] ? path.resolve(process.argv[3]) : undefined);
      for (const warning of result.warnings) console.warn(`WARN: ${warning}`);
      if (result.ok) console.log(`OK: ${jsonPath}`);
      else { for (const error of result.errors) console.error(`ERROR: ${error}`); process.exitCode = 1; }
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
