import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const { RAIL_SKILLS_WIDGET_ID } = require('../lib/common/rail-ids.js');
const { SKILLS_PANEL_TEXT, skillAskOutcomeMessage, skillPromptText, skillsPanelNote } =
    require('../lib/browser/skills/skills-panel-model.js');
const widgetSource = readFileSync(new URL('../src/browser/skills/akari-skills-widget.tsx', import.meta.url), 'utf8');

test('スキル widget は共有 ID を使う', () => {
    assert.match(widgetSource, /static readonly ID = RAIL_SKILLS_WIDGET_ID/);
    assert.equal(RAIL_SKILLS_WIDGET_ID, 'akari-skills-widget');
});

test('左パネルのラベルと説明', () => {
    assert.match(widgetSource, /title\.label = 'スキル'/);
    assert.match(widgetSource, /title\.caption = 'パートナーに頼める決まった仕事（\/呼び名）'/);
    assert.equal(SKILLS_PANEL_TEXT.heading, 'スキル');
    assert.equal(SKILLS_PANEL_TEXT.subtitle, 'パートナーに頼める決まった仕事。/呼び名 でも呼べます');
});

test('パートナーへの依頼結果に応じた案内', () => {
    assert.deepEqual(skillAskOutcomeMessage('typed', 'analyze-footage'), { kind: 'none', text: '' });
    assert.deepEqual(skillAskOutcomeMessage('no-partner', 'analyze-footage'),
        { kind: 'warn', text: 'パートナーを開いてから頼んでください' });
    assert.deepEqual(skillAskOutcomeMessage('unsupported', 'analyze-footage'),
        { kind: 'info', text: '「/analyze-footage」をコピーしました。チャットに貼り付けてください' });
    assert.deepEqual(skillAskOutcomeMessage(undefined, 'analyze-footage'),
        { kind: 'warn', text: 'パートナーを開いてから頼んでください' });
    assert.deepEqual(skillAskOutcomeMessage('unexpected', 'analyze-footage'),
        { kind: 'warn', text: 'パートナーを開いてから頼んでください' });
});

test('依頼文は呼び名に半角スペースを続ける', () => {
    assert.equal(skillPromptText('analyze-footage'), '/analyze-footage ');
});

test('注記は開いているプロジェクトに合わせる', () => {
    assert.equal(skillsPanelNote('作品'), 'パートナーの中で `/呼び名` でも呼べます。いま開いている「作品」に使います。');
    assert.equal(skillsPanelNote(undefined), 'パートナーの中で `/呼び名` でも呼べます。');
});
