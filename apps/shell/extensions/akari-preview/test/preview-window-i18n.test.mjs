import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { setLanguage } from '@akari-video/i18n';

const require = createRequire(import.meta.url);
const { t, scriptDictionary, webviewScriptText } = require('../lib/common/preview-text.js');

test('preview window text follows the selected language', () => {
    try {
        setLanguage('ja');
        assert.equal(t('preview.previewWindow.transport.playAction'), '再生');
        setLanguage('en');
        assert.equal(t('preview.previewWindow.transport.playAction'), 'Play');
        assert.equal(t('preview.previewWindow.notice.noAudioError'),
            'No audio was detected. The asset may be silent or its audio format may be unsupported in preview (export is unaffected).');
    } finally { setLanguage(undefined); }
});

test('embedded preview dictionary cannot close its script element', () => {
    const encoded = scriptDictionary({ play: '</script><script>alert(1)</script>' });
    assert.doesNotMatch(encoded, /<\/script>/i);
    assert.deepEqual(JSON.parse(encoded), { play: '</script><script>alert(1)</script>' });
});

test('serialized helpers use the webview dictionary binding', () => {
    assert.equal(webviewScriptText("(0, preview_text_1.t)('preview.example.key')"),
        "t('preview.example.key')");
});
