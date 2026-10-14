import { setLanguage, t } from '@akari-video/i18n';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const preferences = source('../../akari-surfaces/src/browser/akari-preferences.ts');
const sections = source('../../akari-surfaces/src/common/settings-sections.ts');
const dialog = source('../../akari-surfaces/src/browser/akari-settings-dialog.ts');
const frontend = source('../src/browser/akari-preview-frontend-module.ts');
const handler = source('../src/browser/akari-preview-open-handler.ts');
const bootstrap = source('../src/browser/preview-script-bootstrap.ts');

function between(text, start, end) {
    const from = text.indexOf(start);
    const to = text.indexOf(end, from + start.length);
    assert.ok(from >= 0 && to > from, `section not found: ${start}`);
    return text.slice(from, to);
}

test('スクラブ音設定のスキーマは設定側だけが所有し、既定はオフ', () => {
    assert.match(preferences, /export const AKARI_PREVIEW_SCRUB_AUDIO = 'akari\.preview\.scrubAudio';/);
    assert.match(preferences, /\[AKARI_PREVIEW_SCRUB_AUDIO\]: \{\s*type: 'boolean', default: false,/);
    assert.doesNotMatch(frontend, /'akari\.preview\.scrubAudio': \{/);
    assert.match(sections, /export const AKARI_PREVIEW_SCRUB_AUDIO = 'akari\.preview\.scrubAudio';/);
    assert.match(sections, /quality: \[[^\]]*AKARI_PREVIEW_SCRUB_AUDIO\]/);
    assert.match(dialog, /groupCard\(t\('surfaces\.akariSettingsDialog\.ui\.previewLabel'\), this\.preferenceSwitch\(AKARI_PREVIEW_SCRUB_AUDIO, t\('surfaces\.akariSettingsDialog\.ui\.playAudioWhileScrubbingLabel'\), false,/);
    try {
        setLanguage('ja');
        assert.equal(t('surfaces.akariSettingsDialog.ui.playAudioWhileScrubbingLabel'), 'シークしたときに音を鳴らす');
        setLanguage('en');
        assert.equal(t('surfaces.akariSettingsDialog.ui.playAudioWhileScrubbingLabel'), 'Play audio while scrubbing');
    } finally { setLanguage(undefined); }
});

test('host と webview は設定が明示的に true のときだけスクラブ音を有効にする', () => {
    const reads = [...handler.matchAll(/this\.preferences\.get<boolean>\('akari\.preview\.scrubAudio', false\) === true/g)];
    assert.equal(reads.length, 2);
    assert.match(handler, /scrubAudioEnabled = false,/);
    assert.match(bootstrap, /let scrubAudioEnabled = initial\.scrubAudioEnabled === true;/);
    assert.match(handler, /onPreferenceChanged\(event => \{[\s\S]*?widget\.sendMessage\(\{ type: 'akari-preview-set-scrub-audio', enabled \}\)/);
    assert.match(bootstrap, /message\.type === 'akari-preview-set-scrub-audio'[\s\S]*?setScrubAudioEnabled\(message\.enabled\)/);
});

test('オフのときシークと音源準備は controller と AudioContext を生成しない', () => {
    for (const name of ['prepareScrubAudioSources', 'notifyScrubSeek']) {
        const body = between(bootstrap, `const ${name} = () => {`, '\n            };');
        assert.ok(body.indexOf('if (!scrubAudioEnabled) return;') < body.indexOf('ensureScrubAudio()'), name);
    }
    const setter = between(bootstrap, 'const setScrubAudioEnabled = enabled => {', '\n            };');
    assert.match(setter, /scrubAudioEnabled = enabled === true;/);
    assert.match(setter, /else if \(scrubAudio\) \{\s*scrubAudio\.enabled = false;/);
});
