import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(
  join(here, '..', 'src', 'browser', 'akari-preview-open-handler.ts'),
  'utf8',
);
const serviceSource = readFileSync(
  join(here, '..', 'src', 'node', 'akari-preview-service.ts'),
  'utf8',
);

test('overlay, layer, and cut writes share the edit-store version-routing helper', () => {
  assert.match(source, /import \{[^}]*resolvePreviewItemWrite[^}]*\} from '@akari-video\/edit-store'/s);
  assert.match(source, /resolvePreviewItemWrite\(await this\.readText\(editUri\), \{\s*kind: 'overlay'/s);
  assert.match(source, /resolvePreviewItemWrite\(originalText, \{\s*kind: 'layer'/s);
  assert.match(source, /resolvePreviewItemWrite\(originalText, \{\s*kind: 'cut'/s);
  assert.doesNotMatch(source, /Array\.isArray\(edit\?\.(?:overlays|layers|cuts)\)/);
});

test('v2 html writes retain the legacy project-boundary and existence gates', () => {
  assert.match(source, /htmlPath\.split\(\/\[\\\\\/\]\//);
  assert.match(source, /プロジェクト外への書き込みは拒否しました/);
  assert.match(source, /this\.fileService\.exists\(target\)/);
  assert.match(source, /this\.recentWrites\.set\(target\.toString\(\), Date\.now\(\)\)/);
});

test('slot edits route params to edit.json while ordinary text edits retain html file writes', () => {
  assert.match(source, /params\?: Record<string, string>/);
  assert.match(source, /params: this\.stringRecord\(value\?\.params\)/);
  assert.match(source, /if \(typeof request\.patch\.html === 'string'\)/);
  assert.match(serviceSource, /readFileSync\(resolve\(directory, 'slot-params\.js'\)/);
  assert.match(serviceSource, /readFileSync\(resolve\(directory, 'overlay-runtime\.js'\)/);
});

test('failed write responses surface a dismissible high-contrast banner', () => {
  assert.match(source, /id="write-error-banner"[^>]*role="alert"/);
  assert.match(source, /id="write-error-dismiss"[^>]*>×<\/button>/);
  assert.match(source, /window\.akari\.showWriteError\(reason\)/);
  assert.match(source, /background: #4a1117; color: #fff4f4/);
  assert.doesNotMatch(source, /layer transform write rejected; reverting/);
  assert.doesNotMatch(source, /layer crop write rejected; reverting/);
  assert.doesNotMatch(source, /cut transform write rejected; reverting/);
});
