import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const contribution = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-contribution.ts'), 'utf8');
const widget = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-widget.ts'), 'utf8');

test('preview caption ID selection reaches the caption inspector snapshot', () => {
    assert.match(contribution, /const PREVIEW_CAPTION_SELECTED_EVENT = 'akari\.preview\.captionSelected'/);
    assert.match(contribution, /handleCaptionSelection\(request\.editUri, request\.captionId\)/);
    assert.match(widget, /handleCaptionSelection\(editUri: string, captionId: string \| null\)/);
    assert.match(widget, /this\.applySelection\(\{ kind: 'caption', id: captionId \}, false\)/);
    assert.match(widget, /kind: 'caption', id: caption\.id, text: caption\.text/);
    assert.match(widget, /sourceStart: caption\.start, sourceEnd: caption\.end/);
    assert.match(widget, /effectiveTextStyle/);
    const preview = readFileSync(
        join(here, '..', '..', 'akari-preview', 'src', 'browser', 'akari-preview-open-handler.ts'),
        'utf8'
    );
    assert.match(preview, /if \(captionId === selectedCaptionId\) \{\s*updateCaptionSelectBox\(\);\s*if \(report\) window\.akari\.reportCaptionSelection\(selectedCaptionId\)/);
});
