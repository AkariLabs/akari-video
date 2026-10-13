import { after as afterI18n } from 'node:test';
import { setLanguage } from '@akari-video/i18n';
setLanguage('ja');
afterI18n(() => setLanguage(undefined));
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { t } = require('../lib/common/partner-text.js');
const { decideExtensionCliPreference } = require('../lib/common/extension-cli-alignment.js');

const read = name => readFileSync(new URL(`../src/browser/${name}`, import.meta.url), 'utf8');
const alignerSource = read('partner-extension-cli-aligner.ts');
const source = ts.createSourceFile('partner-extension-cli-aligner.ts', alignerSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'PartnerExtensionCliAligner');
const members = ['inFlight', 'startupAlign', 'align', 'alignEntry', 'offerReload', 'alignOnStartup'].map(name =>
    owner.members.find(node => node.name?.getText(source) === name).getText(source));
const compiled = ts.transpileModule(`class Aligner { ${members.join('\n')} }\nAligner`, {
    compilerOptions: { target: ts.ScriptTarget.ES2021 }
}).outputText;

const entry = { form: 'extension', agent: 'codex', extensionId: 'openai.chatgpt', name: 'Codex 拡張',
    managedCli: { preference: 'chatgpt.cliExecutable', platforms: ['win32-x64'] } };
const managedExe = 'C:\\Users\\someone\\AppData\\Local\\AKARI Video\\codex\\current\\bin\\codex.exe';
const newer = { reason: 'managed-newer', executablePath: managedExe, bundledVersion: '0.147.0-alpha.1.2', managedVersion: '0.161.0', managedPaths: [managedExe] };

function aligner({ platform = 'win32-x64', alignment = newer, current, installed = true, packagePath = 'C:\\plugins\\openai.chatgpt\\extension',
    choice = '後で', catalog = [entry] } = {}) {
    const calls = { resolve: [], set: [], info: [], reload: 0 };
    const Aligner = vm.runInContext(compiled, vm.createContext({
        PARTNER_CATALOG: catalog, UNCHANGED: { changed: false }, PreferenceScope: { User: 'user-scope' },
        decideExtensionCliPreference, t, console: { warn() {}, info() {} }, setTimeout: callback => callback()
    }));
    const subject = new Aligner();
    subject.partnerServer = {
        getPlatformKey: async () => platform,
        resolveExtensionCli: async (...args) => { calls.resolve.push(args); return alignment; }
    };
    subject.extensionsModel = { resolve: async () => ({ installed, plugin: packagePath ? { metadata: { model: { packagePath } } } : undefined }) };
    subject.preferences = {
        ready: Promise.resolve(),
        inspect: name => { assert.equal(name, 'chatgpt.cliExecutable'); return { globalValue: current }; },
        set: async (...args) => { calls.set.push(args); }
    };
    subject.messageService = { info: async (...args) => { calls.info.push(args); return choice; } };
    subject.windowService = { reload: () => { calls.reload += 1; } };
    return { subject, calls };
}

test('同梱の CLI が古いとき、拡張の設定を AKARI 管理の CLI へ向けて知らせを返す', async () => {
    const { subject, calls } = aligner();
    const outcome = await subject.align(entry);
    assert.deepEqual(calls.resolve, [['codex', 'C:\\plugins\\openai.chatgpt\\extension']]);
    assert.deepEqual(calls.set, [['chatgpt.cliExecutable', managedExe, 'user-scope']]);
    assert.equal(outcome.changed, true);
    assert.equal(outcome.detail, 'Codex 拡張 の中の CLI が古い版（0.147.0-alpha.1.2）なので、AKARI が入れた新しい版（0.161.0）を使うように切り替えました。再読み込みすると新しいモデルを選べます');
    // 知らせは返すだけで、再読み込みは呼び出し側が勧める。
    assert.equal(calls.info.length, 0);
});

test('すでに向いている・利用者が自分で入れた値・確かめていないプラットフォームでは書き換えない', async () => {
    const aligned = aligner({ current: managedExe });
    assert.deepEqual(await aligned.subject.align(entry), { changed: false });
    assert.equal(aligned.calls.set.length, 0);

    const custom = aligner({ current: 'D:\\dev\\codex\\target\\debug\\codex.exe' });
    assert.deepEqual(await custom.subject.align(entry), { changed: false });
    assert.equal(custom.calls.set.length, 0);

    const mac = aligner({ platform: 'darwin-arm64' });
    assert.deepEqual(await mac.subject.align(entry), { changed: false });
    assert.deepEqual([mac.calls.resolve.length, mac.calls.set.length], [0, 0]);

    const notInstalled = aligner({ installed: false });
    assert.deepEqual(await notInstalled.subject.align(entry), { changed: false });
    const noPackage = aligner({ packagePath: '' });
    assert.deepEqual(await noPackage.subject.align(entry, 3), { changed: false });
    assert.deepEqual([notInstalled.calls.resolve.length, noPackage.calls.resolve.length], [0, 0]);

    const plain = aligner();
    assert.deepEqual(await plain.subject.align({ ...entry, managedCli: undefined }), { changed: false });
    assert.equal(plain.calls.resolve.length, 0);
});

test('同梱が追いついたら AKARI が入れた値を外し、失敗は書き換えずに握りつぶす', async () => {
    const cleared = aligner({ current: managedExe, alignment: { reason: 'bundled-current', managedPaths: [managedExe] } });
    const outcome = await cleared.subject.align(entry);
    assert.deepEqual(cleared.calls.set, [['chatgpt.cliExecutable', undefined, 'user-scope']]);
    assert.equal(outcome.detail, 'Codex 拡張 を、拡張に入っている CLI を使う設定に戻しました。反映には再読み込みが必要です');

    const broken = aligner();
    broken.subject.partnerServer.resolveExtensionCli = async () => { throw new Error('rpc closed'); };
    assert.deepEqual(await broken.subject.align(entry), { changed: false });
    assert.equal(broken.calls.set.length, 0);
});

test('起動時は書き換えたときだけ 1 回だけ再読み込みを勧め、選ばれたときだけ再読み込みする', async () => {
    const quiet = aligner({ current: managedExe });
    await quiet.subject.alignOnStartup();
    assert.deepEqual([quiet.calls.info.length, quiet.calls.reload], [0, 0]);

    const later = aligner();
    await Promise.all([later.subject.alignOnStartup(), later.subject.alignOnStartup()]);
    assert.equal(later.calls.set.length, 1);
    assert.equal(later.calls.info.length, 1);
    // 知らせは時間で消さず、選ぶまで残す（vm の中で作られた値なので文字列にして比べる）。
    assert.equal(JSON.stringify(later.calls.info[0].slice(1)), JSON.stringify([{ timeout: 0 }, '今すぐ再読み込み', '後で']));
    assert.equal(later.calls.reload, 0);

    const reload = aligner({ choice: t('partner.partnerPanel.extensionUpdater.reloadAction') });
    await reload.subject.alignOnStartup();
    assert.equal(reload.calls.reload, 1);
});

test('カタログは Codex 拡張だけに、確かめたプラットフォームの設定名を持つ', () => {
    const catalog = JSON.parse(readFileSync(new URL('../src/common/partner-catalog.json', import.meta.url), 'utf8'));
    assert.deepEqual(catalog.filter(item => item.managedCli).map(item => [item.id, item.managedCli]),
        [['openai/codex-extension', { preference: 'chatgpt.cliExecutable', platforms: ['win32-x64'] }]]);
});

test('拡張を開く 2 つの経路と起動時の両方で CLI を合わせる', () => {
    const widget = read('akari-partner-widget.tsx');
    assert.equal([...widget.matchAll(/await this\.alignExtensionCli\(entry\);\s*await this\.openExtension\(entry\);/g)].length, 2);
    assert.match(read('akari-partner-contribution.ts'), /void this\.extensionCliAligner\.alignOnStartup\(\);/);
    assert.match(read('akari-partner-frontend-module.ts'), /bind\(PartnerExtensionCliAligner\)\.toSelf\(\)\.inSingletonScope\(\);/);
});
