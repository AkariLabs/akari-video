#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '../../../..');
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'issue69-repro-'));
try {
  const mode = process.argv[2] ?? 'after';
  const race = mode.startsWith('race-');
  const revision = race ? mode.slice(5) : mode;
  let modulePath = path.join(root, 'skills/compile-review-session/bin/core/review-store.mjs');
  if (revision === 'before') {
    modulePath = path.join(scratch, 'review-store-before.mjs');
    const source = execFileSync('git', ['show', '92a0dd48:skills/compile-review-session/bin/core/review-store.mjs'], { cwd: root });
    await fs.writeFile(modulePath, source);
  } else assert.equal(revision, 'after', 'before / after / race-before / race-after を指定してください');
  const { appendAnnotationsAtomic } = await import(pathToFileURL(modulePath));
  const review = path.join(scratch, 'review.json');
  if (race) {
    const worker = `const {appendAnnotationsAtomic}=await import(process.argv[1]);
      while(!(await import('node:fs/promises')).access(process.argv[3]).then(()=>true,()=>false))
        await new Promise(resolve=>setTimeout(resolve,5));
      await appendAnnotationsAtomic(process.argv[2],[{text:process.argv[4]}]);`;
    const gate = path.join(scratch, 'start');
    const children = Array.from({ length: 24 }, (_, index) => new Promise((resolve, reject) => {
      const child = spawn(process.execPath,
        ['--input-type=module', '-e', worker, pathToFileURL(modulePath).toString(), review, gate, `並行 ${index}`]);
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += chunk; });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(stderr || `worker exit ${code}`)));
    }));
    await new Promise(resolve => setTimeout(resolve, 500));
    await fs.writeFile(gate, 'start');
    await Promise.all(children);
    const annotations = JSON.parse(await fs.readFile(review, 'utf8')).annotations;
    console.log(JSON.stringify({ mode, attempted: 24, retained: annotations.length,
      uniqueIds: new Set(annotations.map(item => item.id)).size }));
  } else {
    const nine = await appendAnnotationsAtomic(review, Array.from({ length: 9 }, (_, i) => ({ text: `初回 ${i + 1}` })));
    const sessionDir = path.join(scratch, 'review/sessions/s-0011');
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(path.join(sessionDir, 'session.json'), JSON.stringify({ compiledAnnotations: nine.map(item => item.id) }));
    // 失われた review.json がある状況だけを再現する。削除の原因はこのスクリプトでは再現しない。
    await fs.rm(review);
    const two = await appendAnnotationsAtomic(review, [{ text: '後続 1' }, { text: '後続 2' }]);
    const result = { mode, firstCount: nine.length,
      afterCount: JSON.parse(await fs.readFile(review, 'utf8')).annotations.length,
      secondIds: two.map(item => item.id), reusedIds: two.map(item => item.id).filter(id => nine.some(item => item.id === id)) };
    console.log(JSON.stringify(result));
  }
} finally {
  await fs.rm(scratch, { recursive: true, force: true });
}
