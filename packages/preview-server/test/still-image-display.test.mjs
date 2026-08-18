import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

// 実機バグ報告 preview-server-still-image-never-shown（2026-08-17）の回帰ガード。
// index.html のスタイルシートが #preview-image を display:none で定義しているため、
// showStillImageForSegment() が img.style.display = '' で「表示」しようとすると
// インライン宣言が消えるだけでスタイルシートの none が生き残り、静止画 cut ソース
// （docs/contract-2026-08-12-still-image-cut-source-v0.md）が永久に表示されない。
// 表示側は none に勝つ具体値（block）を明示的に書くこと。

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const appSource = await readFile(join(packageRoot, 'public', 'app.js'), 'utf8');
const htmlSource = await readFile(join(packageRoot, 'public', 'index.html'), 'utf8');

function extractFunction(source, name) {
  const at = source.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `${name} が public/app.js に見つからない`);
  const open = source.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(at, i + 1);
    }
  }
  assert.fail(`${name} の関数本体を閉じられない`);
}

test('index.html は #preview-image を stylesheet 既定 display:none で定義している（前提の固定）', () => {
  assert.match(htmlSource, /#preview-image\s*\{[^}]*display:\s*none/);
});

test('showStillImageForSegment は stylesheet の none に勝つ display を明示する', () => {
  const fn = extractFunction(appSource, 'showStillImageForSegment');
  assert.match(fn, /img\.style\.display\s*=\s*'block'/);
  assert.doesNotMatch(fn, /img\.style\.display\s*=\s*''/,
    "'' の代入はインライン宣言の削除にすぎず stylesheet の display:none を打ち消さない");
});
