#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fields = new Set(['id', 'kind', 'to', 'from', 'trigger', 'expand', 'scope', 'note', 'source', 'added_at', 'hits']);
const scopes = new Set(['note', 'task', 'partner']);
const usage = '使い方: node packages/schemas/bin/validate-voice-dictionary.mjs <voice-dictionary.json>';
const key = text => String(text ?? '').normalize('NFKC').toLowerCase().replace(/\s/gu, '');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const phrase = value => typeof value === 'string' && /\S/u.test(value);

export function validateVoiceDictionary(value) {
  const errors = [], info = [], warnings = [];
  const result = (tooNew = false) => ({ valid: errors.length === 0, errors, info, warnings, tooNew });
  if (!plain(value)) { errors.push('voice-dictionary.json のルートは object である必要があります'); return result(); }
  if (Number.isInteger(value.version) && value.version > 0) {
    errors.push(`version ${value.version} は新しすぎます。このファイルは新しい形式です。アプリを更新してください`);
    return result(true);
  }
  for (const field of Object.keys(value)) if (field !== 'version' && field !== 'entries') errors.push(`ルート.${field} は未定義のフィールドです`);
  if (value.version !== 0) errors.push('version は整数の 0 である必要があります');
  if (!Array.isArray(value.entries)) { errors.push('entries は配列である必要があります'); return result(); }
  const ids = new Set(), keys = new Map();
  for (const [index, entry] of value.entries.entries()) {
    const label = `entries[${index}]`;
    if (!plain(entry)) { errors.push(`${label} は object である必要があります`); continue; }
    for (const field of Object.keys(entry)) if (!fields.has(field)) info.push(`voice-dictionary.unknown-field: ${label}.${field}`);
    if (!phrase(entry.id)) errors.push(`${label}.id は必須の文字列です`);
    else if (ids.has(entry.id)) errors.push(`${label}.id が重複しています`);
    else ids.add(entry.id);
    if (entry.kind !== 'fix' && entry.kind !== 'snippet') errors.push(`${label}.kind は fix / snippet のいずれかです`);
    if (entry.kind === 'fix' && !phrase(entry.to)) errors.push(`${label}.to は必須の文字列です`);
    const listName = entry.kind === 'snippet' ? 'trigger' : 'from';
    const values = entry[listName];
    if (entry.kind === 'fix' || entry.kind === 'snippet') {
      if (!Array.isArray(values) || values.length === 0) errors.push(`${label}.${listName} は 1 件以上必要です`);
      else for (const [i, value] of values.entries()) {
        if (!phrase(value)) { errors.push(`${label}.${listName}[${i}] は空でない文字列が必要です`); continue; }
        const normalized = key(value), previous = keys.get(normalized);
        if (previous !== undefined) errors.push(`${label}.${listName}[${i}] の正規化キーが entries[${previous}] と衝突しています`);
        else keys.set(normalized, index);
      }
    }
    if (entry.kind === 'snippet') {
      if (typeof entry.expand !== 'string' || [...entry.expand].length < 1 || [...entry.expand].length > 2000) errors.push(`${label}.expand は 1〜2000 文字が必要です`);
      else {
        if (/sk-[A-Za-z0-9_-]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|[A-Za-z0-9]{40,}/u.test(entry.expand)) warnings.push(`${label}.expand に鍵らしき文字列があります`);
        if (new RegExp(`/${'Users'}/|[A-Za-z]:\\\\`, 'u').test(entry.expand)) warnings.push(`${label}.expand に絶対パスがあります`);
      }
      if (entry.scope !== undefined && (!Array.isArray(entry.scope) || entry.scope.some(scope => !scopes.has(scope)))) errors.push(`${label}.scope は note / task / partner のみです（jev は使えません）`);
    }
    if (entry.note !== undefined && typeof entry.note !== 'string') errors.push(`${label}.note は文字列です`);
    if (entry.source !== undefined && typeof entry.source !== 'string') errors.push(`${label}.source は文字列です`);
    if (entry.added_at !== undefined && (typeof entry.added_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/u.test(entry.added_at) || !Number.isFinite(Date.parse(entry.added_at)))) errors.push(`${label}.added_at は日時です`);
    if (entry.hits !== undefined && (!Number.isInteger(entry.hits) || entry.hits < 0)) errors.push(`${label}.hits は 0 以上の整数です`);
  }
  return result();
}

export function runValidateVoiceDictionaryCli(argv = process.argv.slice(2), io = {}) {
  const stdout = io.stdout ?? (line => process.stdout.write(`${line}\n`));
  const stderr = io.stderr ?? (line => process.stderr.write(`${line}\n`));
  if (argv.length !== 1) { stderr(usage); return 2; }
  let value;
  try { value = JSON.parse(fs.readFileSync(path.resolve(argv[0]), 'utf8')); }
  catch (error) { stderr(`辞書を読めません: ${error.message}`); return 1; }
  const checked = validateVoiceDictionary(value);
  for (const warning of checked.warnings) stderr(`warning: ${warning}`);
  for (const item of checked.info) stderr(`info: ${item}`);
  if (!checked.valid) { for (const error of checked.errors) stderr(`- ${error}`); return 1; }
  stdout(`OK: ${path.resolve(argv[0])}`);
  return 0;
}

function isMainModule() {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]); }
  catch { return false; }
}
if (isMainModule()) process.exitCode = runValidateVoiceDictionaryCli();
