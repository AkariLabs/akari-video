#!/usr/bin/env node

// UI-b（timeline-row-visuals）L1 用フィクスチャ。
// 内部リポ fieldtest `2026-08-31-object-tree-manual-test` を**複製**して使う（契約: 読み取りのみ・複製して使う）。
// 元案件がそのまま 3 つの検証対象を持っているので合成は足さない:
//   - v-main    : cut-a(0-180) / cut-b(180-330) = 同一段で時間的に隣接する 2 カット → (a)
//   - v-captions: caps（字幕袋・captions.json 6 行）                              → (b)
//   - v-parts   : intro（HTML 袋・parts-demo.html の data-akari-part）             → (b)
//   - v-deco    : g-deco（純グループ・子 2）                                        → (c)

import { cp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import path from 'node:path';

const [, , workspaceDir, sourceProjectArg] = process.argv;
const sourceProject = sourceProjectArg ?? process.env.AKARI_FIELDTEST_DIR;
if (!workspaceDir || !sourceProject) {
  throw new Error('usage: prepare-fixture.mjs <workspaceDir> <object-tree-fieldtest>');
}

const projectDir = path.join(workspaceDir, 'project');
await rm(projectDir, { recursive: true, force: true });
await mkdir(projectDir, { recursive: true });
await cp(sourceProject, projectDir, { recursive: true, force: true });
await mkdir(path.join(projectDir, 'assets'), { recursive: true });
await mkdir(path.join(projectDir, 'overlays'), { recursive: true });

try {
  await access(path.join(projectDir, 'review.json'));
} catch {
  await writeFile(path.join(projectDir, 'review.json'), '{ "version": 0, "annotations": [] }\n');
}
console.log(`prepared timeline-row-visuals L1 fixture at ${projectDir}`);
