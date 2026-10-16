#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(await fs.readFile(path.join(root, 'playbook.schema.json'), 'utf8'));
let checkSchema;
try {
  const { default: Ajv2020 } = await import('ajv/dist/2020.js');
  checkSchema = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !/(?:package|module) 'ajv(?:\/dist\/2020\.js)?'/u.test(error.message)) throw error;
}
const headings = ['目的とできあがり', '流れ', '設定値', '必要な素材（仮枠）', '使った部品', '要る道具', 'ライセンス', '出どころ'];

// ajv を同梱しない CLI では、schema の required と基本的な型だけを確認する。
function checkBasicShape(value, definition, location = '') {
  const rule = definition.$ref ? schema.$defs[definition.$ref.split('/').at(-1)] : definition;
  const errors = [];
  const typeMatches = rule.type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
    : rule.type === 'array' ? Array.isArray(value)
      : rule.type === 'integer' ? Number.isInteger(value)
        : rule.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
          : rule.type ? typeof value === rule.type : true;
  if (!typeMatches) return [`${location || '/'} must be ${rule.type}`];
  if (rule.type === 'object') {
    for (const key of rule.required ?? []) {
      if (!Object.hasOwn(value, key)) errors.push(`${location || '/'} must have required property '${key}'`);
    }
    for (const [key, property] of Object.entries(rule.properties ?? {})) {
      if (Object.hasOwn(value, key)) errors.push(...checkBasicShape(value[key], property, `${location}/${key}`));
    }
  } else if (rule.type === 'array' && rule.items) {
    for (const [index, item] of value.entries()) errors.push(...checkBasicShape(item, rule.items, `${location}/${index}`));
  }
  return errors;
}

export async function validatePlaybook(playbook, { markdown, skillsDir = path.resolve(root, '../../skills') } = {}) {
  const errors = [];
  const warnings = [];
  if (checkSchema) {
    if (!checkSchema(playbook)) {
      errors.push(...checkSchema.errors.map(error => `${error.instancePath || '/'} ${error.message}`));
    }
  } else {
    errors.push(...checkBasicShape(playbook, schema));
    warnings.push('ajv が無いため schema の詳細な検査を省きました');
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
  const placeholderIds = new Set((Array.isArray(playbook?.placeholders) ? playbook.placeholders : []).map(item => item?.id));
  const beatIds = new Set();
  for (const [index, beat] of (Array.isArray(playbook?.beats) ? playbook.beats : []).entries()) {
    if (beatIds.has(beat?.id)) errors.push(`beats[${index}].id は重複できません`);
    beatIds.add(beat?.id);
    if (beat?.placeholder && !placeholderIds.has(beat.placeholder)) {
      warnings.push(`beats[${index}].placeholder が見つかりません: ${beat.placeholder}`);
    }
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
    if (playbook?.beats && !found.includes('内訳')) errors.push('playbook.md に見出しがありません: 内訳');
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
