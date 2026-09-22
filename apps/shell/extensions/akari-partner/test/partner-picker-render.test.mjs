import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const catalog = JSON.parse(read('../src/common/partner-catalog.json'));
const iconClasses = Object.fromEntries(catalog.map(entry => [entry.agent, `akari-partner-${entry.agent}-cli-icon`]));
// partner-open.test.mjs と同じ AST 抽出・transpile の流儀で、実際の描画メソッドを実行。
// Theia の起動や接続操作は要らず、React の要素ツリーだけを観測する。
function renderer(file, className, methods) {
    const text = read(`../src/browser/${file}`);
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === className);
    const selected = methods.map(name => cls.members.find(node =>
        ts.isMethodDeclaration(node) && node.name.getText(source) === name
    ).getText(source));
    const styles = source.statements.filter(node => ts.isVariableStatement(node)).map(node => node.getText(source));
    const code = ts.transpileModule(`${styles.join('\n')}\nclass Picker { ${selected.join('\n')} }`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React }
    }).outputText;
    const React = { createElement: (type, props, ...children) => ({ type, props: props ?? {}, children }) };
    return new (new Function('React', 'PARTNER_CATALOG', 'PARTNER_CLI_ICON_CLASSES', `${code}\nreturn Picker;`)(
        React, catalog, iconClasses
    ))();
}

function nodes(tree) {
    return [tree, ...(tree?.children ?? []).flat(Infinity).flatMap(child =>
        child && typeof child === 'object' ? nodes(child) : []
    )];
}

function partner() {
    return Object.assign(renderer('akari-partner-widget.tsx', 'AkariPartnerWidget', ['renderOnboarding', 'renderConnected']), {
        entryFlow: () => ({ state: 'failed', status: '失敗', detail: '詳細', warning: '別の警告' }),
        entryActionLabel: () => 'セットアップ',
        extensionViewLost: () => true,
        selected: catalog[0]
    });
}

test('両状態の重複見出しは隠し、見出しの寸法・タブ名・説明文は維持する', () => {
    const picker = partner();
    for (const [method, title] of [['renderOnboarding', 'パートナーを追加'], ['renderConnected', 'パートナー接続済み']]) {
        const headings = nodes(picker[method]()).filter(node => node.type === 'h2');
        assert.equal(headings.length, 1);
        assert.deepEqual(headings[0].children, [title]);
        assert.deepEqual(headings[0].props.style, { margin: '0 0 10px', fontSize: 21, visibility: 'hidden' });
    }
    const onboarding = JSON.stringify(picker.renderOnboarding());
    assert.ok(onboarding.includes('CLI または公式拡張を選んで、右パネルに追加します。'));
    assert.match(read('../src/browser/akari-partner-widget.tsx'), /this.title.label = 'パートナーを追加';/);
});

test('caution データがあっても両ピッカーに描画せず、他の警告・復帰ヒントは残す', () => {
    const picker = partner();
    const onboarding = picker.renderOnboarding();
    const left = renderer('akari-partner-catalog-widget.tsx', 'AkariPartnerCatalogWidget', ['renderSlot']);
    const slots = catalog.map(entry => left.renderSlot(entry.form, entry));
    const trees = [onboarding, ...slots];
    assert.equal(catalog.filter(entry => entry.caution).length, 2);
    for (const tree of trees) {
        assert.ok(nodes(tree).every(node => !Object.hasOwn(node.props, 'data-partner-caution')));
        assert.ok(!JSON.stringify(tree).includes('拡張ホストが再起動すると会話が切れます'));
    }
    assert.ok(JSON.stringify(onboarding).includes('別の警告'));
    assert.ok(nodes(onboarding).some(node => node.props['data-akari-partner-resume-hint'] === 'true'));
    assert.ok(JSON.stringify(slots).includes('導入時にプラットフォーム用バイナリを検証'));
    assert.equal(nodes(onboarding).filter(node => node.type === 'button' && node.props['data-partner-form']).length, catalog.length);
});

test('推奨 Claude のアイコンだけにテーマ背景の下地を付け、ボタンの寸法・順序を維持する', () => {
    const buttons = nodes(partner().renderOnboarding()).filter(node =>
        node.type === 'button' && node.props['data-partner-form']
    );
    assert.deepEqual(buttons.map(button => button.props['data-partner-entry']), catalog.map(entry => entry.id));
    for (const button of buttons) {
        const entry = catalog.find(entry => entry.id === button.props['data-partner-entry']);
        const icon = nodes(button).find(node => node.props.className === iconClasses[entry.agent]);
        assert.ok(icon);
        const backing = nodes(button).find(node =>
            node.type === 'span' && node.props.style?.background === 'var(--theia-editor-background)'
        );
        assert.equal(button.props.style.minHeight, 46);
        assert.equal(button.props.style.width, '100%');
        if (entry.recommended) {
            assert.equal(entry.agent, 'claude');
            assert.equal(button.props.className, 'theia-button main');
            assert.deepEqual(backing?.children, [icon]);
            assert.deepEqual(backing.props.style, {
                display: 'inline-flex', flex: 'none', padding: 2, margin: -2,
                borderRadius: 4, background: 'var(--theia-editor-background)'
            });
            assert.equal(button.props.style.background, undefined);
        } else {
            assert.equal(button.props.className, 'theia-button secondary');
            assert.equal(backing, undefined);
            assert.equal(button.props.style.background, 'transparent');
        }
    }
});
