import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

test('テロップのカードだけ contain を渡し、ほかのカードは cover を使う', () => {
  const widget = readFileSync(new URL('../src/browser/akari-role-buckets-widget.tsx', import.meta.url), 'utf8');
  const card = readFileSync(new URL('../src/browser/library-card-view.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('widget.tsx', widget, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const klass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AkariRoleBucketsWidget');
  const method = klass.members.find(node => node.name?.getText(ast) === 'renderTextLookPage').getText(ast);
  assert.match(method, /telops=\{telopItems\.map\([\s\S]*?<LibraryAssetCard[\s\S]*?thumbnailFit=['"]contain['"]/u);
  assert.equal((widget.match(/thumbnailFit=/gu) ?? []).length, 1);
  assert.match(card, /thumbnailFit\?: 'contain' \| 'cover'/u);
  assert.match(card, /props\.thumbnailFit === 'contain'[\s\S]*?objectFit: 'contain'[\s\S]*?padding: '6px'[\s\S]*?boxSizing: 'border-box'/u);
  assert.match(card, /: \{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' \}/u);
  assert.match(card, /background: AKARI_SURFACE\.card/u);
});
