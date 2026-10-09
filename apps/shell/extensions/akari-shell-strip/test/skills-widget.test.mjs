import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const require = createRequire(import.meta.url);
const ts = require('typescript');
const { RAIL_SKILLS_WIDGET_ID } = require('../lib/common/rail-ids.js');
const { SKILLS_PANEL_TEXT, skillAskOutcomeMessage, skillPromptText, skillsPanelNote } =
    require('../lib/browser/skills/skills-panel-model.js');
const { readProjectTitle } = require('../lib/browser/skills/project-title.js');
const widgetSource = readFileSync(new URL('../src/browser/skills/akari-skills-widget.tsx', import.meta.url), 'utf8');

function descriptionLeadFromWidget() {
    const source = ts.createSourceFile('akari-skills-widget.tsx', widgetSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const declaration = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'skillDescriptionLead');
    assert.ok(declaration, '説明の先頭を返す関数を export する');
    const compiled = ts.transpileModule(declaration.getText(source), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    const exports = {};
    runInNewContext(compiled, { exports });
    return exports.skillDescriptionLead;
}

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

test('カードは呼び名と説明の先頭を二行で表示する', () => {
    assert.match(widgetSource, /className='skill-name' title=\{`\/\$\{skill\.name\}`\}>\/{skill\.name}/);
    assert.match(widgetSource, /\.skill-name\s*\{[^}]*overflow: hidden; text-overflow: ellipsis;[^}]*white-space: nowrap;/);
    assert.match(widgetSource, /\.skill-name-row\s*\{[^}]*display: flex;/);
    assert.doesNotMatch(widgetSource, /\.skill-more\s*\{[^}]*position: absolute;/);
    assert.match(widgetSource, /className='skill-description'>{skillDescriptionLead\(skill\.description\)}/);
    assert.doesNotMatch(widgetSource, /className='skill-alias'/);
    assert.match(widgetSource, /min-height: 64px/);
    assert.match(widgetSource, /\.skill-art\s*\{[^}]*width: 64px; height: 44px;/);
    assert.match(widgetSource, /<SkillPictogram name=\{skill\.name\} category=\{group\.category\}/);
    assert.match(widgetSource, /-webkit-line-clamp: 2/);
});

test('吹き出しのプロジェクト名は intake の title を優先する', async () => {
    const root = { path: { base: '旧フォルダ名' }, resolve: name => name };
    const files = value => ({ readFile: async () => ({ value: { toString: () => value } }) });
    assert.equal(await readProjectTitle(files('{"title":"新しい作品名"}'), root), '新しい作品名');
    assert.equal(await readProjectTitle(files('{"title":"  "}'), root), '旧フォルダ名');
    assert.equal(await readProjectTitle(files('{"title":42}'), root), '旧フォルダ名');
    assert.equal(await readProjectTitle({ readFile: async () => { throw Error('missing'); } }, root), '旧フォルダ名');
    assert.match(widgetSource, /intakeUri\?\.isEqual\(change\.resource\)/);
});

test('説明の先頭は最初の区切りで切り出す', () => {
    const lead = descriptionLeadFromWidget();
    assert.equal(lead('短い説明。続き'), '短い説明');
    assert.equal(lead('短い説明（補足）'), '短い説明');
    assert.equal(lead('短い説明—続き'), '短い説明');
    assert.equal(lead('短い説明: 続き'), '短い説明');
    assert.equal(lead('区切りのない説明'), '区切りのない説明');
    assert.equal(lead('  区切りのない説明  '), '  区切りのない説明  ');
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
