#!/usr/bin/env node
// 依存ゼロ。任意の SKILL.md パスを渡すと一時 fixture でも同じ検査を行える。
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const forbiddenTerms = [
  '文字起こし', '字幕', 'テロップ', '書き出し', 'レンダリング', 'ナレーション', 'BGM',
  '効果音', '3D', 'ワールド', '編集計画', 'カット', '素材分析', 'レビュー',
  'export', 'render', 'caption', 'subtitle', 'narration', 'transcribe', 'analyze', 'overlay', 'world',
];

// frontmatter の文字列だけを扱う。未対応の YAML は通過させず失敗にする。
export function frontmatterScalar(text, key) {
  const block = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
  if (!block) throw new Error('frontmatter がありません');
  const lines = block.split(/\r?\n/);
  const indices = lines.flatMap((line, i) => line.startsWith(`${key}:`) ? [i] : []);
  if (indices.length !== 1) throw new Error(`${key} が欠落または重複しています`);
  const index = indices[0];
  let value = lines[index].slice(key.length + 1).trim();
  const continuation = [];
  for (let i = index + 1; i < lines.length && /^(\s|$)/.test(lines[i]); i++) continuation.push(lines[i].trim());
  if (/^[>|][-+]?$/.test(value)) value = continuation.join(value.startsWith('>') ? ' ' : '\n');
  else {
    value = [value, ...continuation].join(' ').trim();
    if (value.startsWith('"')) value = JSON.parse(value);
    else if (value.startsWith("'")) {
      if (!value.endsWith("'")) throw new Error(`${key} の引用符が不正です`);
      value = value.slice(1, -1).replace(/''/g, "'");
    } else if (/^[\[\]{&*!]/.test(value)) throw new Error(`${key} は文字列にしてください`);
  }
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${key} が空です`);
  return value;
}

export function checkEntrySkill(path = join(root, 'skills/akari/SKILL.md')) {
  const text = readFileSync(path, 'utf8');
  if (frontmatterScalar(text, 'name') !== 'akari') throw new Error('name は akari にしてください');
  const description = frontmatterScalar(text, 'description');
  const names = readdirSync(join(root, 'skills'), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'akari')
    .map(entry => frontmatterScalar(readFileSync(join(root, 'skills', entry.name, 'SKILL.md'), 'utf8'), 'name'));
  const found = [...new Set([...names, ...forbiddenTerms])]
    .filter(term => description.toLowerCase().includes(term.toLowerCase()));
  if (found.length) throw new Error(`description に禁止語があります: ${found.join(', ')}`);
  const length = [...description].length;
  if (length > 200) throw new Error(`description は 200 文字以内です（${length} 文字）`);
  return length;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const length = checkEntrySkill(process.argv[2]);
    console.log(`check-entry-skill: PASS（description ${length} 文字・禁止語 0）`);
  } catch (error) {
    console.error(`check-entry-skill: ${error.message}`);
    process.exitCode = 1;
  }
}
