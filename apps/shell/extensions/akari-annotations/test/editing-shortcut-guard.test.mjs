import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
    isEditableEventTarget,
    shouldStopEditableDeletionKeydown
} from 'akari-preview/lib/common/review-tool-mode.js';

const here = dirname(fileURLToPath(import.meta.url));
const widget = readFileSync(join(here, '..', 'src', 'browser', 'akari-annotations-widget.ts'), 'utf8');
const preview = readFileSync(
    join(here, '..', '..', 'akari-preview', 'src', 'browser', 'akari-preview-open-handler.ts'),
    'utf8'
);

test('typing targets share one guard before timeline and preview shortcuts', () => {
    for (const target of [
        { tagName: 'INPUT' },
        { tagName: 'TEXTAREA' },
        { tagName: 'DIV', isContentEditable: true }
    ]) {
        assert.equal(isEditableEventTarget(target), true);
    }
    assert.match(widget, /return isEditableEventTarget\(target as HTMLElement \| null\)/);
    assert.match(widget, /if \(!this\.isAttached \|\| this\.isEditableTarget\(event\.target\) \|\| this\.isEditableTarget\(document\.activeElement\)\) \{\s*return;/);
    assert.match(preview, /const isEditable = \(\$\{isEditableEventTarget\.toString\(\)\}\)/);
    assert.match(preview, /isEditable\(event\.target\)[\s\S]*isEditable\(document\.activeElement\)/);
});

test('inner editable Delete is stopped before Theia can synthesize an iframe keydown', () => {
    assert.equal(isEditableEventTarget({ tagName: 'IFRAME' }), false, 'host-side iframe is not editable');
    const innerStopped = shouldStopEditableDeletionKeydown(
        { tagName: 'SPAN', isContentEditable: true },
        { tagName: 'DIV', isContentEditable: true },
        'Delete', false, false
    );
    const hostDeleteWouldFire = !innerStopped && !isEditableEventTarget({ tagName: 'IFRAME' });
    assert.equal(innerStopped, true);
    assert.equal(hostDeleteWouldFire, false);
    assert.match(
        preview,
        /document\.addEventListener\('keydown',[\s\S]*shouldStopEditableDeletionKeydownFn[\s\S]*event\.stopPropagation\(\)[\s\S]*\}, true\)/
    );
});
