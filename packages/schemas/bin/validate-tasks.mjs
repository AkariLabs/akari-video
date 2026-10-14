#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { realpathSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';

const schemaPath = fileURLToPath(new URL('../tasks.schema.json', import.meta.url));
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: false });
const check = ajv.compile(schema);
const choices = {
  via: ['voice', 'pen', 'pointer', 'canvas', 'typed', 'chat', 'paper', 'jev', 'external'],
  priority: ['high', 'normal', 'low'], outcome: ['edited', 'declined', 'failed', 'dismissed'],
  gate: ['auto-ok', 'ask'], createdBy: ['human', 'app', 'ai'],
  kind: ['edit', 'generate', 'fix', 'ask', 'note'], confidence: ['high', 'low'],
  risk: ['reversible', 'outbound'], route: ['agent', 'human']
};

export function validateTasks(doc) {
  const errors = [];
  const warnings = [];
  if (!check(doc)) {
    for (const issue of check.errors ?? []) {
      errors.push(`ERROR ${issue.instancePath || '/'}: ${schemaMessage(issue)}`);
    }
  }
  if (!doc || !Array.isArray(doc.tasks)) return { ok: errors.length === 0, errors, warnings };
  const ids = new Set();
  for (const [index, task] of doc.tasks.entries()) {
    if (!task || typeof task !== 'object' || Array.isArray(task)) continue;
    const at = `tasks[${index}]`;
    if (typeof task.id === 'string') {
      if (ids.has(task.id)) errors.push(`ERROR ${at}.id: 重複しています (${task.id})`);
      ids.add(task.id);
    }
    for (const [key, accepted] of Object.entries(choices)) {
      if (task[key] != null && typeof task[key] === 'string' && !accepted.includes(task[key])) {
        warnings.push(`WARN ${at}.${key}: 未知の値です (${task[key]})`);
      }
    }
    if (task.ref?.kind != null && !['annotation', 'lint', 'export', 'proposal'].includes(task.ref.kind)) {
      warnings.push(`WARN ${at}.ref.kind: 未知の値です`);
    }
    if (task.ref?.kind === 'annotation' && !/^a-\d{4,}$/.test(task.ref.id ?? '')) {
      warnings.push(`WARN ${at}.ref.id: 注釈 id の形式が異なります`);
    }
    if (task.state === 'done' && task.outcome == null) warnings.push(`WARN ${at}.outcome: 結果がありません`);
    if (task.risk === 'outbound' && task.gate === 'auto-ok') errors.push(`ERROR ${at}: 外部へ出るタスクを自動実行にできません`);
    if (task.undo?.reversible === false && task.undo.historyId != null) warnings.push(`WARN ${at}.undo.historyId: 戻せないタスクに履歴があります`);
    if (task.needsConfirm === true && ['sent', 'review', 'done'].includes(task.state)) warnings.push(`WARN ${at}.needsConfirm: 未確認のタスクが進行しています`);
  }
  for (const [index, task] of doc.tasks.entries()) {
    if (!Array.isArray(task?.dependsOn)) continue;
    for (const id of task.dependsOn) if (!ids.has(id)) warnings.push(`WARN tasks[${index}].dependsOn: ${id} がありません`);
  }
  return { ok: errors.length === 0, errors, warnings };
}

function schemaMessage(issue) {
  const field = issue.params?.missingProperty ?? issue.params?.additionalProperty;
  switch (issue.keyword) {
    case 'required': return `${field} が必要です`;
    case 'type': {
      const names = { object: 'オブジェクト', array: '配列', string: '文字列', number: '数値', integer: '整数', boolean: '真偽値', null: 'null' };
      return `型が違います（${names[issue.params.type] ?? '指定された型'}が必要です）`;
    }
    case 'enum': return '許可された値ではありません';
    case 'const': return '版または固定値が違います';
    case 'pattern': return '形式が違います';
    case 'minItems': return '要素が足りません';
    case 'maxItems': return '要素が多すぎます';
    case 'minimum': return '値が小さすぎます';
    case 'maximum': return '値が大きすぎます';
    case 'additionalProperties': return `${field} は使えません`;
    default: return '形式が不正です';
  }
}

const invoked = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invoked) {
  const usage = '使い方: node packages/schemas/bin/validate-tasks.mjs <tasks.json>';
  if (process.argv.length !== 3) {
    console.error(usage);
    process.exitCode = 2;
  } else {
    const target = path.resolve(process.argv[2]);
    try {
      const result = validateTasks(JSON.parse(fs.readFileSync(target, 'utf8')));
      for (const warning of result.warnings) console.error(warning);
      for (const error of result.errors) console.error(error);
      console.log(`${result.ok ? 'OK' : 'NG'}: ${target}`);
      process.exitCode = result.ok ? 0 : 1;
    } catch {
      console.error('ERROR tasks.json を JSON として読めません');
      console.log(`NG: ${target}`);
      process.exitCode = 1;
    }
  }
}
