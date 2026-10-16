#!/usr/bin/env node
import fs from 'node:fs/promises';
import { createReadStream, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
let schema;
let editSchema;
let schemaCheckerPromise;
const playbookSchema = () => schema ??= JSON.parse(readFileSync(path.join(root, 'playbook.schema.json'), 'utf8'));
function itemSchema() {
  if (!editSchema) {
    try { editSchema = JSON.parse(readFileSync(path.join(root, 'edit.schema.json'), 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      editSchema = { $defs: {} };
    }
  }
  return editSchema;
}
function schemaChecker() {
  schemaCheckerPromise ??= (async () => {
    try {
      // optional-import: ajv/dist/2020.js — 同梱しない CLI では下の ERR_MODULE_NOT_FOUND で基本検査に落ちる
      const { default: Ajv2020 } = await import('ajv/dist/2020.js');
      return new Ajv2020({ allErrors: true, strict: false }).compile(playbookSchema());
    } catch (error) {
      if (error.code !== 'ERR_MODULE_NOT_FOUND' || !/(?:package|module) 'ajv(?:\/dist\/2020\.js)?'/u.test(error.message)) throw error;
      return null;
    }
  })();
  return schemaCheckerPromise;
}
const headings = ['目的とできあがり', '流れ', '設定値', '必要な素材（仮枠）', '使った部品', '要る道具', 'ライセンス', '出どころ'];

async function sha256File(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

// ajv を同梱しない CLI では、schema の required と基本的な型だけを確認する。
function checkBasicShape(value, definition, location = '') {
  const rule = definition.$ref ? playbookSchema().$defs[definition.$ref.split('/').at(-1)] : definition;
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

function checkItemShape(item, location = 'template/item.json') {
  const editSchema = itemSchema();
  const sourceKind = item?.source?.kind;
  const suffix = { media: 'Media', html: 'Html', shape: 'Shape', telop: 'Telop', filter: 'Filter',
    group: 'Group', captions: 'Captions', caption: 'Caption' }[sourceKind];
  if (!suffix) return [`${location} source.kind が itemV2 ではありません`];
  const rule = editSchema.$defs[`itemV2${suffix}`];
  const errors = [];
  if (!rule) return [`${location} の itemV2 schema が見つかりません`];
  if (!item || typeof item !== 'object' || Array.isArray(item)) return [`${location} は itemV2 ではありません`];
  for (const key of rule.required) if (!Object.hasOwn(item, key)) errors.push(`${location} に ${key} がありません`);
  for (const key of Object.keys(item)) if (!Object.hasOwn(rule.properties, key)) errors.push(`${location}/${key} は itemV2 にありません`);
  if (typeof item.id !== 'string' || !item.id.trim() || !Number.isInteger(item.at) || item.at < 0
    || !Number.isInteger(item.duration) || item.duration < 0) errors.push(`${location} の id/at/duration が不正です`);
  const sourceRule = editSchema.$defs[`itemSource${suffix}V2`];
  if (sourceRule) {
    for (const key of sourceRule.required ?? []) if (!Object.hasOwn(item.source ?? {}, key)) errors.push(`${location}/source に ${key} がありません`);
    for (const key of Object.keys(item.source ?? {})) if (!Object.hasOwn(sourceRule.properties ?? {}, key)) errors.push(`${location}/source/${key} は不正です`);
    for (const [key, value] of Object.entries(item.source ?? {})) {
      const field = sourceRule.properties?.[key];
      if (!field) continue;
      const primitive = field.$ref ? editSchema.$defs[field.$ref.split('/').at(-1)] : field;
      if (primitive?.const !== undefined && value !== primitive.const
        || primitive?.enum && !primitive.enum.includes(value)
        || primitive?.type === 'string' && (typeof value !== 'string' || !value.trim())
        || primitive?.type === 'number' && (!Number.isFinite(value) || value < (primitive.minimum ?? 0))
        || primitive?.type === 'integer' && (!Number.isInteger(value) || value < (primitive.minimum ?? 0)))
        errors.push(`${location}/source/${key} は edit.schema の形ではありません`);
    }
    if (sourceKind === 'group' && item.source.canvas !== undefined) {
      const canvas = item.source.canvas;
      if (!canvas || !['user', 'plan'].includes(canvas.origin) || canvas.durationMode !== 'fixed'
        || Object.keys(canvas).some(key => !['origin', 'durationMode', 'intent', 'background'].includes(key)))
        errors.push(`${location}/source/canvas は edit.schema の形ではありません`);
    }
  }
  if (Array.isArray(item.items)) item.items.forEach((child, index) => errors.push(...checkItemShape(child, `${location}/items/${index}`)));
  else if (item.items !== undefined) errors.push(`${location}/items は配列である必要があります`);
  return errors;
}

/** Pure fragment checks; file integrity is checked separately by validateTemplateFiles. */
export function validateTemplateFragment(playbook, item) {
  const errors = [];
  const warnings = [];
  const referenced = new Set();
  const nodes = new Map();
  if (!item || item.source?.kind !== 'group' || item.source.canvas?.origin !== 'user')
    errors.push('template/item.json は canvas.origin: user の group 項目である必要があります');
  errors.push(...checkItemShape(item));
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (nodes.has(node.id)) errors.push(`template/item.json の id が重複しています: ${node.id}`);
    nodes.set(node.id, node);
    const source = node.source ?? {};
    for (const key of ['src', 'path', 'baked', 'derivedFrom']) {
      if (typeof source[key] !== 'string') continue;
      const ref = source[key];
      if (!/^template\/media\/[^./][^/]*$/u.test(ref)) errors.push(`素材参照は template/media/ の相対パスだけです: ${ref}`);
      else referenced.add(ref);
    }
    if (typeof node.mask === 'string') {
      if (!/^template\/media\/[^./][^/]*$/u.test(node.mask)) errors.push(`素材参照は template/media/ の相対パスだけです: ${node.mask}`);
      else referenced.add(node.mask);
    }
    if (node.keyframes && !Array.isArray(node.keyframes) && typeof node.keyframes.path === 'string')
      errors.push(`断片の外部キーフレームはテンプレに入れられません: ${node.keyframes.path}`);
    for (const child of node.items ?? []) walk(child);
  };
  if (item && typeof item === 'object') walk(item);
  const declared = new Set();
  for (const media of playbook.template?.media ?? []) {
    if (declared.has(media.path)) errors.push(`template.media の path が重複しています: ${media.path}`);
    declared.add(media.path);
    if (media.source === 'site') errors.push(`site の素材はテンプレに入れられません: ${media.path}`);
    if (!['CC0-1.0', playbook.license].includes(media.license))
      errors.push(`素材のライセンスがテンプレより厳しいです: ${media.path}`);
    if (!referenced.has(media.path)) warnings.push(`使われていない素材: ${media.path}`);
  }
  for (const ref of referenced) if (!declared.has(ref)) errors.push(`template.media に未掲載の素材: ${ref}`);
  const linked = new Set();
  const usedItems = new Set();
  const placeholders = new Set((playbook.placeholders ?? []).map(slot => slot.id));
  for (const slot of playbook.template?.slots ?? []) {
    if (!placeholders.has(slot.placeholder) || linked.has(slot.placeholder)) errors.push(`スロットの placeholder が不正です: ${slot.placeholder}`);
    linked.add(slot.placeholder);
    const target = nodes.get(slot.item);
    if (!target || target.source?.kind !== 'group' || target.source.canvas?.origin !== 'plan' || usedItems.has(slot.item))
      errors.push(`スロットの item は断片内の仮枠である必要があります: ${slot.item}`);
    usedItems.add(slot.item);
  }
  for (const id of placeholders) if (!linked.has(id)) warnings.push(`スロットに結ばれていない仮枠: ${id}`);
  return { errors, warnings, referenced };
}

async function validateTemplateFiles(playbook, baseDir) {
  const errors = []; const warnings = [];
  if (!baseDir) return { errors: ['depth 3 の検査には baseDir が必要です'], warnings };
  const rootReal = await fs.realpath(baseDir);
  let item;
  try {
    const itemFile = await fs.realpath(path.join(baseDir, 'template', 'item.json'));
    if (!itemFile.startsWith(`${rootReal}${path.sep}`)) throw new Error('作り方の外を指しています');
    item = JSON.parse(await fs.readFile(itemFile, 'utf8'));
  }
  catch (error) { return { errors: [`template/item.json を読めません: ${error.message}`], warnings }; }
  const fragment = validateTemplateFragment(playbook, item);
  errors.push(...fragment.errors); warnings.push(...fragment.warnings);
  for (const media of playbook.template?.media ?? []) {
    if (!/^template\/media\/[^./][^/]*$/u.test(media.path ?? '')) continue;
    try {
      const mediaFile = await fs.realpath(path.join(baseDir, media.path));
      if (!mediaFile.startsWith(`${rootReal}${path.sep}`)) throw new Error('作り方の外を指しています');
      const actual = await sha256File(mediaFile);
      if (actual !== media.sha256) errors.push(`sha256 が一致しません: ${media.path}`);
    } catch (error) { errors.push(`素材を読めません: ${media.path}: ${error.message}`); }
  }
  return { errors, warnings };
}

export async function validatePlaybook(playbook, { markdown, baseDir, skillsDir = path.resolve(root, '../../skills') } = {}) {
  const errors = [];
  const warnings = [];
  const checkSchema = await schemaChecker();
  if (checkSchema) {
    if (!checkSchema(playbook)) {
      errors.push(...checkSchema.errors.map(error => `${error.instancePath || '/'} ${error.message}`));
    }
  } else {
    errors.push(...checkBasicShape(playbook, playbookSchema()));
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
  if (playbook?.depth === 3) {
    if (!playbook.template) errors.push('depth 3 には template が必要です');
    const result = await validateTemplateFiles(playbook, baseDir);
    errors.push(...result.errors); warnings.push(...result.warnings);
  } else if (playbook?.template !== undefined) errors.push('depth 1/2 に template は置けません');
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
  return validatePlaybook(playbook, { markdown, baseDir: path.dirname(jsonPath) });
}

async function runCliIfMain() {
  if (!process.argv[1]) return;
  const [requested, actual] = await Promise.all([
    fs.realpath(path.resolve(process.argv[1])).catch(() => ''),
    fs.realpath(fileURLToPath(import.meta.url))
  ]);
  if (requested !== actual) return;
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
void runCliIfMain().catch(error => { console.error(error.message); process.exitCode = 1; });
