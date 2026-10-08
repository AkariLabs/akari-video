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
    return new (new Function('React', 'PARTNER_CATALOG', 'PARTNER_CLI_ICON_CLASSES', 'PARTNER_LAST_KEY', `${code}\nreturn Picker;`)(
        React, catalog, iconClasses, 'akari.partner.last'
    ))();
}

function nodes(tree) {
    return [tree, ...(tree?.children ?? []).flat(Infinity).flatMap(child =>
        child && typeof child === 'object' ? nodes(child) : []
    )];
}

function partner() {
    return Object.assign(renderer('akari-partner-widget.tsx', 'AkariPartnerWidget', ['renderOnboarding', 'renderConnected', 'refreshLastPartner', 'rememberPartnerStart']), {
        entryFlow: () => ({ state: 'failed', status: '失敗', detail: '詳細', warning: '別の警告' }),
        entryActionLabel: () => 'セットアップ',
        extensionViewLost: () => true,
        selected: catalog[0]
    });
}

test('一覧の見出しは場所を取らず読み上げ可能にし、接続済みの見た目を維持する', () => {
    const picker = partner();
    for (const [method, title, expected] of [
        ['renderOnboarding', 'パートナーを追加', { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }],
        ['renderConnected', 'パートナー接続済み', { margin: '0 0 10px', fontSize: 21, visibility: 'hidden' }]
    ]) {
        const headings = nodes(picker[method]()).filter(node => node.type === 'h2');
        assert.equal(headings.length, 1);
        assert.deepEqual(headings[0].children, [title]);
        assert.deepEqual(headings[0].props.style, expected);
    }
    const onboardingTree = picker.renderOnboarding();
    assert.deepEqual(onboardingTree.props.style.padding, '12px 16px 20px 12px');
    assert.equal(nodes(onboardingTree).some(node => node.props.className === 'codicon codicon-add'), false);
    assert.equal(picker.renderConnected().props.style.padding, '28px 22px');
    const onboarding = JSON.stringify(onboardingTree);
    assert.ok(onboarding.includes('CLI・作業画面・公式拡張を選んで、右パネルに追加します。'));
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
            node.type === 'span' && node.props.style?.padding === 2 && node.props.style?.background === 'var(--theia-editor-background)'
        );
        assert.equal(button.props.style.minHeight, 46);
        assert.equal(button.props.style.height, 'auto');
        assert.equal(button.props.style.padding, '8px 6px');
        assert.equal(button.props.style.marginLeft, 0);
        assert.equal(button.props.style.flex, '1 1 auto');
        assert.equal(button.props.style.width, '100%');
        const action = nodes(button).find(node => node.props.style?.whiteSpace === 'nowrap' && node.props.style?.marginLeft === 'auto');
        assert.equal(action.props.style.fontSize, 10);
        const label = nodes(button).find(node => node.props.style?.display === 'flex' && node.props.style?.minWidth === 'min(100%, 100px)');
        assert.equal(label.props.style.whiteSpace, 'normal');
        assert.equal(label.children.length, 2);
        const text = label.children[1];
        assert.equal(text.props.style.flex, '1 1 0');
        assert.equal(text.props.style.minWidth, 0);
        assert.equal(text.props.style.flexWrap, 'wrap');
        const name = nodes(text).find(node => node.children.includes(entry.name));
        assert.ok(name);
        assert.equal(name.props.style.wordBreak, 'keep-all');
        assert.equal(name.props.style.overflowWrap, 'anywhere');
        const recommended = nodes(button).find(node => node.type === 'span' && node.children.includes('推奨'));
        if (entry.recommended) {
            assert.equal(recommended.props.style.height, 16);
            assert.equal(recommended.props.style.fontSize, 11);
            assert.equal(recommended.props.style.background, 'var(--theia-editor-background)');
            assert.equal(recommended.props.style.color, 'var(--akari-accent-light)');
        } else {
            assert.equal(recommended, undefined);
        }
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
    const rows = nodes(partner().renderOnboarding()).filter(node => node.type === 'div' && node.props.style?.gap === 10 && node.props.style?.display === 'flex' && !node.props.style.flexDirection);
    assert.ok(rows.length > 0);
    assert.ok(rows.every(row => row.props.style.alignItems === 'stretch'));
});

test('保存された entryId のセルだけに「前回」を付け、オンボーディング回答は参照しない', async () => {
    const picker = partner();
    const extension = catalog.find(entry => entry.form === 'extension');
    const cli = catalog.find(entry => entry.form === 'cli' && !entry.recommended);
    const web = catalog.find(entry => entry.form === 'web');
    const main = catalog.find(entry => entry.recommended);
    let readKey;
    picker.storageService = { getData: async key => { readKey = key; return { entryId: extension.id, at: '2026-10-08' }; } };
    picker.update = () => {};
    await picker.refreshLastPartner();
    assert.equal(readKey, 'akari.partner.last');
    const badges = () => nodes(picker.renderOnboarding()).filter(node => node.type === 'button' && node.props['data-partner-entry'])
        .filter(button => nodes(button).some(node => node.type === 'span' && node.children.includes('前回')))
        .map(button => button.props['data-partner-entry']);
    assert.deepEqual(badges(), [extension.id]);
    const lastBadge = nodes(picker.renderOnboarding()).find(node => node.type === 'span' && node.children.includes('前回'));
    assert.equal(lastBadge.props.style.height, 16);
    assert.equal(lastBadge.props.style.fontSize, 11);
    assert.equal(lastBadge.props.style.color, 'var(--akari-accent-light)');
    assert.equal(lastBadge.props.style.border, '1px solid var(--akari-accent-light)');
    picker.storageService.getData = async () => ({ entryId: cli.id });
    await picker.refreshLastPartner();
    assert.deepEqual(badges(), [cli.id]);
    picker.storageService.getData = async () => ({ entryId: web.id });
    await picker.refreshLastPartner();
    assert.deepEqual(badges(), [web.id]);
    picker.storageService.getData = async () => ({ entryId: main.id });
    await picker.refreshLastPartner();
    assert.deepEqual(badges(), [main.id]);
    const mainBadge = nodes(picker.renderOnboarding()).find(node => node.type === 'span' && node.children.includes('前回'));
    assert.equal(mainBadge.props.style.height, 16);
    assert.equal(mainBadge.props.style.fontSize, 11);
    assert.equal(mainBadge.props.style.color, 'currentColor');
    assert.equal(mainBadge.props.style.border, '1px solid currentColor');
    picker.storageService.getData = async () => ({ entryId: null });
    await picker.refreshLastPartner();
    assert.deepEqual(badges(), []);
    assert.doesNotMatch(read('../src/browser/akari-partner-widget.tsx'), /akariOnboardingAnswer|前回選んだ/);
});

test('拡張を開いても自動再開用の last 記録は書き換えない', () => {
    const sourceText = read('../src/browser/akari-partner-widget.tsx');
    const source = ts.createSourceFile('akari-partner-widget.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const cls = source.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AkariPartnerWidget');
    const method = cls.members.find(node => ts.isMethodDeclaration(node) && node.name.getText(source) === 'openExtension');
    assert.ok(method);
    assert.doesNotMatch(method.getText(source), /rememberPartnerStart|PARTNER_LAST_KEY|setData/);
    assert.match(sourceText, /protected async rememberPartnerStart\(entry: PartnerCliCatalogEntry \| PartnerWebCatalogEntry\)/);
});

test('一覧の末尾の設定リンクはパートナー節を開く', async () => {
    const picker = partner();
    const calls = [];
    picker.commandService = { executeCommand: async (...args) => { calls.push(args); } };
    const tree = picker.renderOnboarding();
    const link = nodes(tree).find(node => node.type === 'button' && node.children.includes('パートナーの設定'));
    assert.ok(link);
    assert.equal(link.props.className, 'theia-button quiet');
    assert.equal(link.children[0].props.className, 'codicon codicon-gear');
    assert.equal(link.props.style.marginLeft, 0);
    assert.equal(tree.children.at(-1), link);
    link.props.onClick();
    assert.deepEqual(calls, [['akari.settings.open', { section: 'partner' }]]);
});
