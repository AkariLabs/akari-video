// task/2026-09-08-partner-form-caution 指示8:
// カタログの任意フィールド `caution`（拡張形態の注意書き）が
//   (a) 型どおりに入っていること
//   (b) 表示条件が `caution` の有無だけで決まっていること（`form` から導出していないこと）
// を守る。(b) は描画そのものではなくソースの分岐条件を見る — 描画は Theia の
// ReactWidget クラスメソッド内の JSX なので、純関数として切り出すには両ウィジェットの
// 手術が要る（判断の理由は report.md に記載）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const catalogUrl = new URL('../src/common/partner-catalog.json', import.meta.url);
const catalogTypeUrl = new URL('../src/browser/partner-catalog.ts', import.meta.url);
const catalogWidgetUrl = new URL('../src/browser/akari-partner-catalog-widget.tsx', import.meta.url);
const partnerWidgetUrl = new URL('../src/browser/akari-partner-widget.tsx', import.meta.url);
const faqJaUrl = new URL('../../../../../docs/how-to/faq.ja.md', import.meta.url);

// 本票（task.md 指示1）が定めた文面。UI と FAQ で一字も違わないこと自体が価値なので定数で持つ。
const CAUTION_TEXT = '拡張ホストが再起動すると会話が切れます。長い作業には CLI 形態をおすすめします。';

const BASE_KEYS = ['id', 'agent', 'name', 'description', 'recommended'];
const EXTENSION_KEYS = ['extensionId', 'viewContainerIds', 'binaryVerification'];
const KNOWN_KEYS = new Set([...BASE_KEYS, ...EXTENSION_KEYS, 'form', 'caution']);

const readCatalog = async () => JSON.parse(await readFile(catalogUrl, 'utf8'));

test('パートナーカタログの全エントリが PartnerCatalogEntry の形に適合する', async () => {
    const catalog = await readCatalog();
    assert.ok(catalog.length > 0);

    for (const entry of catalog) {
        const where = `entry ${entry.id}`;
        for (const key of BASE_KEYS) {
            assert.ok(Object.hasOwn(entry, key), `${where}: ${key} が無い`);
        }
        assert.equal(typeof entry.id, 'string', where);
        assert.equal(typeof entry.agent, 'string', where);
        assert.equal(typeof entry.name, 'string', where);
        assert.equal(typeof entry.description, 'string', where);
        assert.equal(typeof entry.recommended, 'boolean', where);
        assert.ok(['cli', 'extension'].includes(entry.form), `${where}: form が cli / extension でない`);

        if (entry.form === 'extension') {
            assert.equal(typeof entry.extensionId, 'string', where);
            assert.ok(Array.isArray(entry.viewContainerIds), where);
            assert.equal(typeof entry.binaryVerification, 'object', where);
        } else {
            for (const key of EXTENSION_KEYS) {
                assert.ok(!Object.hasOwn(entry, key), `${where}: cli に ${key} が付いている`);
            }
        }

        // caution は任意。あるときは string
        if (Object.hasOwn(entry, 'caution')) {
            assert.equal(typeof entry.caution, 'string', where);
        }

        for (const key of Object.keys(entry)) {
            assert.ok(KNOWN_KEYS.has(key), `${where}: 未知のフィールド ${key}`);
        }
    }
});

test('form: extension の 2 件だけが本票の caution 文面を持つ', async () => {
    const catalog = await readCatalog();
    const extensions = catalog.filter(entry => entry.form === 'extension');

    assert.deepEqual(extensions.map(entry => entry.id), [
        'anthropic/claude-code-extension',
        'openai/codex-extension'
    ]);
    for (const entry of extensions) {
        assert.equal(entry.caution, CAUTION_TEXT, `${entry.id} の caution が本票の文面と違う`);
    }
    assert.deepEqual(
        catalog.filter(entry => entry.caution !== undefined).map(entry => entry.id),
        extensions.map(entry => entry.id)
    );
});

test('caution を持たないエントリ（CLI 8 件）には注意書きの元データが無い', async () => {
    const catalog = await readCatalog();
    const cli = catalog.filter(entry => entry.form === 'cli');

    assert.equal(cli.length, 8);
    for (const entry of cli) {
        assert.equal(entry.caution, undefined, `${entry.id} に caution が付いている`);
    }
});

test('PartnerCatalogEntry の型が caution を任意フィールドとして宣言する', async () => {
    const source = await readFile(catalogTypeUrl, 'utf8');
    assert.match(source, /caution\?: string;/);
});

test('注意書きの表示条件は caution の有無だけで、form から導出しない', async () => {
    for (const url of [catalogWidgetUrl, partnerWidgetUrl]) {
        const source = await readFile(url, 'utf8');
        const file = url.pathname.split('/').pop();

        // 分岐は `entry.caution &&` の 1 形だけ
        const guards = source.match(/\{entry\.caution &&/g) ?? [];
        assert.equal(guards.length, 1, `${file}: caution の分岐が 1 か所でない`);

        // caution に触れる行が form を見ていない（コメント行は除く）
        const offenders = source.split('\n').filter(line =>
            line.includes('entry.caution') && /\bform\b/.test(line) && !line.trimStart().startsWith('//')
        );
        assert.deepEqual(offenders, [], `${file}: caution の表示が form から導出されている`);

        // ホバーしないと読めない置き方（title 属性）にしない
        assert.ok(!/title=\{entry\.caution\}/.test(source), `${file}: caution を title 属性で出している`);
    }
});

test('FAQ（日本語）が UI と同じ語で切断と復帰を説明する', async () => {
    const faq = await readFile(faqJaUrl, 'utf8');

    assert.match(faq, /\*\*Q\. チャットが途中で切れます\*\*/);
    assert.ok(faq.includes('拡張ホストが再起動すると会話が切れます'), 'FAQ が UI と同じ切断の語を使っていない');
    assert.ok(faq.includes('`akari --continue`'), 'FAQ に akari --continue の案内が無い');
    assert.ok(faq.includes('`/akari`'), 'FAQ に /akari の案内が無い');
});

test('パートナー欄の復帰導線が本票の文面と resume-session への導線を持つ', async () => {
    const source = await readFile(partnerWidgetUrl, 'utf8');

    assert.ok(
        source.includes('セッションが切れたときは、パートナー欄で /akari と打つと今の状況から続けられます。ターミナルからは akari --continue です。'),
        '復帰手順の文面が本票と違う'
    );
    assert.ok(source.includes('docs/how-to/resume-session.ja.md'), '復帰手順から resume-session への導線が無い');
});
