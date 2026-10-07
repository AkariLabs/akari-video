import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { JevLocalRunner } = require('../lib/browser/jev-local-runner.js');
const utterance = text => ({ id: text, raw: text, text, final: true, applied: [], t: 0, kind: 'speech' });

function rig(mode = 'screen') {
    const calls = [], cards = [], lines = [], written = [];
    let view = { tab: 'project', materials: { kinds: [], sort: { by: 'name', order: 'asc' }, query: '' },
        library: { source: 'all', price: [], license: [], status: [], query: '' } };
    const commands = {
        async executeCommand(id, args) {
            calls.push([id, args]);
            const previous = structuredClone(view);
            if (id === 'akari.catalog.getView') return structuredClone(view);
            if (id === 'akari.catalog.setMaterialFilter') { view.materials.kinds = [...args.kind]; view.tab = 'project'; }
            if (id === 'akari.catalog.setMaterialSort') { view.materials.sort = { ...args }; view.tab = 'project'; }
            if (id === 'akari.catalog.setMaterialQuery') { view.materials.query = args.query; view.tab = 'project'; }
            if (id === 'akari.library.setFilter') { Object.assign(view.library, args); view.tab = 'library'; }
            if (id === 'akari.catalog.open') {
                view.tab = args.tab;
                (args.tab === 'project' ? view.materials : view.library).query = args.query ?? '';
                if (args.tab === 'library') view.library.category = args.category;
                return !args.category || args.category === 'image';
            }
            if (id === 'akari.catalog.clearFilters') { view.materials.kinds = []; view.library.price = []; }
            if (id === 'akari.tasks.create') return { id: 'task-1' };
            return { matched: true, previous };
        }
    };
    const runner = new JevLocalRunner();
    Object.assign(runner, {
        commands,
        capabilities: { engines: [{ id: 'speechanalyzer-live', available: true }] },
        preferences: { inspect: key => ({ globalValue: key === 'akari.companion.enabled' ? true : mode }),
            set: async (...args) => { written.push(args); mode = args[1]; } },
        dock: { layout: 'open', setLayout() {}, setMark() {}, status: { set: (line, tone, source, actions) => {
            lines.push({ line, tone, source, actions }); return { dispose() {} };
        } } },
        now: { acceptUtterance: value => cards.push({ text: value.text, kind: 'メモ' }),
            acceptAction: (text, kind, id) => cards.push({ text, kind, id }),
            markActionUndone: id => { const card = cards.find(item => item.id === id); if (card) card.undone = true; },
            markActionRedone: id => { const card = cards.find(item => item.id === id); if (card) card.undone = false; } },
        hand: { busy: () => false }
    });
    return { runner, calls, cards, lines, written, getView: () => view };
}

test('メモのみでは操作も文法判定も進まず、切り替えると戻せる', async () => {
    const off = rig('off');
    assert.equal((await off.runner.route(utterance('プロジェクトの動画で'))).outcome, 'memo');
    assert.equal(off.calls.length, 0);
    const active = rig();
    const result = await active.runner.route(utterance('プロジェクトの動画で'));
    assert.equal(result.outcome, 'handled');
    assert.deepEqual(active.getView().materials.kinds, ['video']);
    assert.equal(active.cards[0].kind, '操作');
    assert.equal((await active.runner.route(utterance('戻して'))).outcome, 'handled');
    assert.deepEqual(active.getView().materials.kinds, []);
    assert.equal(active.cards[0].undone, true);
    assert.equal((await active.runner.route(utterance('さっきの'))).outcome, 'handled');
    assert.deepEqual(active.getView().materials.kinds, ['video']);
    assert.equal(active.cards[0].undone, false);
});

test('3 回の取り消しでユーザー設定だけをメモのみに下げる', async () => {
    const { runner, written, getView } = rig();
    for (const speech of ['動画だけ', '短い順', '無料だけ']) await runner.route(utterance(speech));
    for (let i = 0; i < 3; i++) assert.equal((await runner.route(utterance('戻して'))).outcome, 'handled');
    assert.equal(written.length, 1);
    assert.equal(written[0][0], 'akari.vibe.mode');
    assert.equal(written[0][1], 'off');
    assert.deepEqual(getView().materials.kinds, []);
});

test('100 文以上が必ず 1 outcome に着地し、pass は紙の普通の言葉だけ', async () => {
    const { runner } = rig();
    const values = [
        ...Array.from({ length: 50 }, (_, n) => `今日はいい天気${n}`),
        ...Array.from({ length: 20 }, (_, n) => `このカットを消して${n}`),
        ...Array.from({ length: 20 }, (_, n) => `動画で絞らないで${n}`),
        ...Array.from({ length: 10 }, (_, n) => `長い発話${n}${'あ'.repeat(40)}`),
        '', '🙂', '\u0001', '朝食の画像がほしい', 'プロジェクトの動画でこのカットを消して'
    ];
    assert.ok(values.length >= 100);
    for (const value of values) {
        const result = await runner.route(utterance(value));
        assert.ok(['handled', 'memo', 'pass'].includes(result.outcome));
        assert.notEqual(result.outcome, 'pass', value);
    }
    runner.paperOpen = true;
    assert.equal((await runner.route(utterance('ここにロゴが来て'))).outcome, 'pass');
    assert.equal((await runner.route({ ...utterance('ペン'), kind: 'command' })).outcome, 'handled');
});

test('ブラウザ検索は初回確認後だけ実行し、同じ動きは続けて二度実行しない', async () => {
    const previous = globalThis.localStorage;
    const memory = new Map();
    globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
    const { runner, calls, lines } = rig();
    try {
        assert.equal((await runner.route(utterance('ブラウザで朝食を調べて'))).outcome, 'handled');
        assert.equal(calls.filter(([id]) => id === 'akari.browser.search').length, 0);
        assert.ok(lines.at(-1).actions.some(action => action.label === 'はい'));
        assert.equal((await runner.route(utterance('はい'))).outcome, 'handled');
        assert.equal(calls.filter(([id]) => id === 'akari.browser.search').length, 1);
        assert.equal(memory.get('akari.jev.browserSearchNoticeSeen'), '1');
        assert.equal((await runner.route(utterance('ブラウザで朝食を調べて'))).outcome, 'handled');
        assert.equal(calls.filter(([id]) => id === 'akari.browser.search').length, 1);
        assert.equal((await runner.route(utterance('ネットでロゴを探して'))).outcome, 'handled');
        assert.equal(calls.filter(([id]) => id === 'akari.browser.search').length, 2);
    } finally { globalThis.localStorage = previous; }
});

test('10 秒内の 6 件目は操作せずメモへ落とす', async () => {
    const { runner, calls } = rig();
    for (const text of ['動画だけ', '音だけ', '画像だけ', '3Dだけ', '短い順']) {
        assert.equal((await runner.route(utterance(text))).outcome, 'handled');
    }
    const before = calls.length;
    assert.equal((await runner.route(utterance('無料だけ'))).outcome, 'memo');
    assert.equal(calls.length, before);
});

test('二節は順に実行し、当たらない節だけメモへ残す', async () => {
    const { runner, getView, cards } = rig();
    assert.equal((await runner.route(utterance('動画で、短い順'))).outcome, 'handled');
    assert.deepEqual(getView().materials.kinds, ['video']);
    assert.equal(getView().materials.sort.by, 'duration');
    assert.equal((await runner.route(utterance('音だけ、今日は晴れ'))).outcome, 'handled');
    assert.ok(cards.some(card => card.kind === 'メモ' && card.text === '今日は晴れ'));
});

test('ライブラリ検索を戻すと両面の語と元のタブが戻る', async () => {
    const { runner, getView } = rig();
    getView().materials.query = '元の素材';
    getView().library.query = '元のライブラリ';
    assert.equal((await runner.route(utterance('ライブラリで朝食を探して'))).outcome, 'handled');
    assert.equal(getView().tab, 'library');
    assert.equal((await runner.route(utterance('戻して'))).outcome, 'handled');
    assert.equal(getView().tab, 'project');
    assert.equal(getView().materials.query, '元の素材');
    assert.equal(getView().library.query, '元のライブラリ');
});

test('空のライブラリでも画像カテゴリと検索語を適用できれば成功', async () => {
    const { runner, getView, lines, calls } = rig();
    const result = await runner.route(utterance('ライブラリで朝食っぽい画像さがして'));
    assert.equal(result.outcome, 'handled');
    assert.deepEqual(calls.find(([id]) => id === 'akari.catalog.open')?.[1],
        { tab: 'library', query: '朝食っぽい', category: 'image' });
    assert.equal(getView().library.query, '朝食っぽい');
    assert.equal(getView().library.category, 'image');
    assert.equal(lines.at(-1).line, 'やりました: ライブラリの検索');
});

test('catalog.open が副作用の後で失敗を返しても、失敗した一手を含めて戻す', async () => {
    const { runner, calls, getView, lines } = rig();
    getView().materials.query = '元の素材';
    getView().library.query = '元のライブラリ';
    const original = runner.commands.executeCommand.bind(runner.commands);
    runner.commands.executeCommand = async (id, args) => {
        const result = await original(id, args);
        return id === 'akari.catalog.open' && args.category === 'image' && args.query === '朝食っぽい' ? false : result;
    };
    assert.equal((await runner.route(utterance('ライブラリで朝食っぽい画像さがして'))).outcome, 'memo');
    assert.equal(getView().tab, 'project');
    assert.equal(getView().materials.query, '元の素材');
    assert.equal(getView().library.query, '元のライブラリ');
    assert.equal(lines.at(-1).line, '見つかりませんでした');
    assert.ok(calls.filter(([id]) => id === 'akari.catalog.open').length >= 3);
});

test('絞り込み解除は素材の検索語も空にし、戻すと検索語を復元する', async () => {
    const { runner, getView, calls } = rig();
    assert.equal((await runner.route(utterance('プロジェクトでpourを探して'))).outcome, 'handled');
    assert.equal(getView().materials.query, 'pour');
    const start = calls.length;
    assert.equal((await runner.route(utterance('絞り込みを解除'))).outcome, 'handled');
    assert.equal(getView().materials.query, '');
    assert.deepEqual(calls.slice(start).filter(([id]) => id === 'akari.catalog.clearFilters'
        || id === 'akari.catalog.setMaterialQuery').map(([id, args]) => [id, args]), [
        ['akari.catalog.clearFilters', {}], ['akari.catalog.setMaterialQuery', { query: '' }]
    ]);
    assert.equal((await runner.route(utterance('戻して'))).outcome, 'handled');
    assert.equal(getView().materials.query, 'pour');
});

test('matched false の理由を状況の行に出す', async () => {
    const { runner, calls, lines } = rig();
    const original = runner.commands.executeCommand.bind(runner.commands);
    runner.commands.executeCommand = async (id, args) => {
        if (id === 'akari.catalog.setMaterialQuery') {
            calls.push([id, args]);
            return { matched: false };
        }
        return original(id, args);
    };
    assert.equal((await runner.route(utterance('プロジェクトでmissingを探して'))).outcome, 'memo');
    assert.equal(lines.at(-1).line, '見つかりませんでした');
    assert.equal(lines.at(-1).tone, 'warn');
});

test('ブラウザ検索失敗時は戻り値の message を出し、元の発話をメモにし、タブを閉じる', async () => {
    const previous = globalThis.localStorage;
    const memory = new Map();
    globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value) };
    const { runner, calls, lines, cards } = rig();
    const original = runner.commands.executeCommand.bind(runner.commands);
    let browserOpen = false;
    runner.commands.executeCommand = async (id, args) => {
        if (id === 'akari.browser.search') {
            calls.push([id, args]); browserOpen = true;
            return { ok: false, message: '検索サイトを開けません' };
        }
        if (id === 'akari.browser.close') {
            calls.push([id, args]); browserOpen = false;
            return { ok: false, message: 'すでに閉じています' };
        }
        return original(id, args);
    };
    try {
        assert.equal((await runner.route(utterance('ブラウザで朝食の画像を調べて'))).outcome, 'handled');
        assert.equal((await runner.route(utterance('はい'))).outcome, 'handled');
        assert.equal(browserOpen, false);
        assert.equal(calls.filter(([id]) => id === 'akari.browser.close').length, 1);
        assert.equal(lines.at(-1).line, '検索サイトを開けません');
        assert.equal(lines.at(-1).tone, 'warn');
        assert.equal(memory.has('akari.jev.browserSearchNoticeSeen'), false);
        assert.deepEqual(cards.filter(card => card.kind === 'メモ').map(card => card.text),
            ['ブラウザで朝食の画像を調べて']);
        assert.equal((await runner.route(utterance('ブラウザで朝食の画像を調べて'))).outcome, 'handled');
        assert.ok(lines.at(-1).actions.some(action => action.label === 'はい'));
    } finally { globalThis.localStorage = previous; }
});

test('確認の「いいえ」と時間切れは元の発話だけをメモに残す', async () => {
    const previousStorage = globalThis.localStorage;
    const previousSetTimeout = globalThis.setTimeout;
    const previousClearTimeout = globalThis.clearTimeout;
    const timers = [];
    globalThis.localStorage = { getItem: () => null, setItem() {} };
    globalThis.setTimeout = (run, delay) => { timers.push({ run, delay }); return timers.length; };
    globalThis.clearTimeout = () => {};
    const { runner, cards } = rig();
    try {
        const first = 'ブラウザで朝食を調べて';
        const second = 'ブラウザでロゴを探して';
        assert.equal((await runner.route(utterance(first))).outcome, 'handled');
        assert.equal((await runner.route(utterance('いいえ'))).outcome, 'handled');
        assert.equal((await runner.route(utterance(second))).outcome, 'handled');
        timers.filter(timer => timer.delay === 8000).at(-1).run();
        assert.deepEqual(cards.filter(card => card.kind === 'メモ').map(card => card.text), [first, second]);
    } finally {
        globalThis.localStorage = previousStorage;
        globalThis.setTimeout = previousSetTimeout;
        globalThis.clearTimeout = previousClearTimeout;
    }
});
