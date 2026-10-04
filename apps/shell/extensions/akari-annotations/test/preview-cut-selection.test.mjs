import { readHandlerSource } from '../../akari-preview/test/helpers/handler-source.mjs';
import { readAllSourceText } from './helpers/widget-source.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const contribution = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-contribution.ts'), 'utf8');
const widget = readAllSourceText();

test('プレビューの cut ID 選択がタイムライン選択と inspector snapshot へ届く', () => {
    assert.match(contribution, /const PREVIEW_CUT_SELECTED_EVENT = 'akari\.preview\.cutSelected'/);
    assert.match(contribution, /this\.timelineWidget\?\.handleCutSelection\(request\.editUri, request\.cutId\)/);
    assert.match(widget, /handleCutSelection\(editUri: string, cutId: string \| null\)/);
    assert.match(widget, /const index = this\.cutItemIds\.indexOf\(cutId\)/);
    assert.match(widget, /this\.applySelection\(\{ kind: 'cut', index \}, false\)/);
    const previewSource = readHandlerSource();
    assert.match(
        previewSource,
        /if \(cutSelected\) \{\s*updateCutSelectBox\(\);\s*if \(report\) window\.akari\.reportCutSelection\(cutSelectionVideo\(\)\.dataset\.akariCutId \|\| null\)/
    );
});
