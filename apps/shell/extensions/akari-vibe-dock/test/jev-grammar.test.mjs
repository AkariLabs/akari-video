import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const { JEV_GRAMMAR_RULES, matchJev } = require('../lib/common/jev-local-grammar.js');
const closed = { paperOpen: false, confirming: false };
const opened = { paperOpen: true, confirming: false };

test('すべての固定規則は肯定例に当たり反例を実行しない', () => {
    assert.ok(JEV_GRAMMAR_RULES.length >= 30);
    for (const rule of JEV_GRAMMAR_RULES) {
        assert.ok(rule.examples.length >= 2, rule.id);
        assert.ok(rule.counterExamples.length >= 1, rule.id);
        const context = rule.paperOnly ? opened : closed;
        for (const example of rule.examples) {
            const result = matchJev(example, context);
            assert.equal(result?.kind, 'plan', `${rule.id}: ${example}`);
            assert.equal(result.plan.actionId, rule.actionId, `${rule.id}: ${example}`);
        }
        for (const example of rule.counterExamples) assert.notEqual(matchJev(example, context)?.kind, 'plan', `${rule.id}: ${example}`);
    }
});

test('否定と語の門と紙の閉集合', () => {
    for (const value of ['動画で絞らないで', '消さないで', '止めないで', '無料にしないで', '設定を開かないで',
        'ブラウザで検索しないで', '紙を出さないで', '文字を消さないで', '短い順にしないで', '全部出さないで',
        'ライブラリを開かないで', '今の画面を敷かないで']) assert.notEqual(matchJev(value, closed)?.kind, 'plan', value);
    assert.notEqual(matchJev('朝食の画像がほしい', closed)?.kind, 'plan');
    assert.notEqual(matchJev('プロジェクトの動画でこのカットを消して', closed)?.kind, 'plan');
    assert.equal(matchJev('あ'.repeat(41), closed), null);
    for (const value of ['閉じて', 'もう一枚', 'ペン', '送って']) {
        assert.notEqual(matchJev(value, closed)?.kind, 'plan', value);
        assert.equal(matchJev(value, opened)?.kind, 'plan', value);
    }
    assert.equal(matchJev('ブラウザで朝食の画像を調べて', closed)?.plan.value.engine, 'google-images');
    assert.equal(matchJev('ブラウザでYahooで朝食を調べて', closed)?.plan.value.engine, 'yahoo-jp-images');
    assert.equal(matchJev('九十九秒へ', closed)?.plan.value.seconds, 99);
});

test('検索エンジンと設定節の実体に固定文法の値を合わせる', () => {
    const browser = JSON.parse(readFileSync(new URL('../../../../../catalog/browser/browser-engines.json', import.meta.url)));
    const ids = new Set(browser.engines.map(item => item.id));
    for (const text of ['ブラウザで朝食を調べて', 'ネットでPinterestで朝食を探して',
        'ウェブでYahooで朝食を検索して', 'ウェブ上でBingで朝食を調べて']) {
        assert.ok(ids.has(matchJev(text, closed).plan.value.engine), text);
    }
    const sections = readFileSync(new URL('../../akari-surfaces/src/common/settings-sections.ts', import.meta.url), 'utf8');
    for (const [text, id, label] of [['設定を開いて', 'listening', '聞き取り'],
        ['外観の設定を開いて', 'appearance', '外観'], ['書き出しの設定', 'export', '書き出し']]) {
        assert.equal(matchJev(text, closed).plan.value.section, id);
        assert.ok(sections.includes(`id: '${id}', label: '${label}'`));
    }
});
