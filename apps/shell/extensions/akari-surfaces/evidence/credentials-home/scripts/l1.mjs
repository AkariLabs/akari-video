#!/usr/bin/env node
// 再実行: node apps/shell/extensions/akari-surfaces/evidence/credentials-home/scripts/l1.mjs
// 一時 HOME / AKARI_HOME / USERPROFILE / THEIA_CONFIG_DIR / user-data-dir のみ使用。鍵値は証跡へ出さない。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { evalOn, screenshot } from './cdp-lib.mjs';
import { launch, stop, fireCommand, saveJson, waitEval, sanitize } from './l1-lib.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.resolve(ROOT, '..', '..', '..', '..', '..', '..');
const SHELL = path.join(REPO, 'apps/shell');
const ELECTRON = path.join(SHELL, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const RESULTS = path.join(ROOT, 'results-l1.json');
const fal = 'dummy-not-a-real-key';
const groq = 'dummy-groq-not-a-real-key';
const webhook = 'dummy';
const names = ['旧だけの fal 鍵が登録済み・旧い場所の札を表示', '移行で新へコピー・600・旧を残し札を消す',
    '画面から groq を登録し新だけへ保存', '既存の Discord 設定を移行・登録後も保持'];
const out = { status: 'running', checks: names.map(name => ({ name, pass: false, detail: '未実行' })) };
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const q = JSON.stringify;
const provider = id => `[data-akari-settings-section="connections"] [data-akari-provider="${id}"]`;

async function available(port) {
    const server = net.createServer();
    try {
        await new Promise((resolve, reject) => server.once('error', reject).listen(port, '127.0.0.1', resolve));
        return true;
    } catch { return false; }
    finally { if (server.listening) await new Promise(resolve => server.close(resolve)); }
}

async function check(index, callback) {
    try { out.checks[index].detail = await callback(); out.checks[index].pass = true; }
    catch (error) { out.checks[index].detail = sanitize(error, REPO); }
    await saveJson(RESULTS, out);
}

let session;
let scratch;
try {
    await saveJson(RESULTS, out);
    let port;
    for (let candidate = 19661; candidate <= 19670; candidate++) {
        if (await available(candidate)) { port = candidate; break; }
    }
    assert(port, '指定範囲に空き CDP ポートがありません');
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'akari-credentials-l1-'));
    const home = path.join(scratch, 'home');
    const akariHome = path.join(scratch, 'akari-home');
    const config = path.join(scratch, 'theia-config');
    const userData = path.join(scratch, 'user-data');
    const project = path.join(scratch, 'project');
    const legacy = path.join(home, '.config/akari-video/credentials.env');
    const primary = path.join(akariHome, 'credentials.env');
    for (const dir of [path.dirname(legacy), akariHome, config, project]) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(legacy, `FAL_KEY=${fal}\n`, { mode: 0o600 });
    fs.writeFileSync(primary, `# existing\nDISCORD_RELEASE_WEBHOOK_URL=${webhook}\n`, { mode: 0o600 });
    const originalLegacy = fs.readFileSync(legacy, 'utf8');
    const environment = { HOME: home, USERPROFILE: home, AKARI_HOME: akariHome, THEIA_CONFIG_DIR: config };
    session = await launch({ shellDir: SHELL, electron: ELECTRON, project, port, isoDir: userData, environment });
    out.electron = { pid: session.pid, cdpPort: port, pidMatched: true, isolated: true };
    await evalOn(session.cdp, fireCommand('akari.settings.open', 'connections'));
    await waitEval(session.cdp, `Boolean(document.querySelector('[data-akari-settings-section="connections"]:not([hidden])'))`, { label: '接続と API キー節' });
    await check(0, async () => {
        const state = await waitEval(session.cdp, `(()=>{const c=document.querySelector(${q(provider('fal'))});return c?.querySelector('[data-credential-source="legacy"]')&&c.querySelector('.akari-set-prov-status')?.textContent?.includes('登録済み')?{badge:true,registered:true}:null})()`, { label: 'fal 旧ファイル表示' });
        assert(state.badge && state.registered, '旧ファイル表示がありません');
        await screenshot(session.cdp, path.join(ROOT, '01-legacy.png'));
        return { registered: true, legacyBadge: true };
    });
    await check(1, async () => {
        const clicked = await evalOn(session.cdp, `(()=>{const b=[...document.querySelectorAll(${q(provider('fal') + ' button')})].find(b=>b.textContent.trim()==='新しい場所へ移す');if(!b)return false;b.click();return true})()`);
        assert(clicked, '移行ボタンがありません');
        await waitEval(session.cdp, `!document.querySelector(${q(provider('fal') + ' [data-credential-source="legacy"]')})`, { label: '移行後の札消失' });
        const primaryText = fs.readFileSync(primary, 'utf8');
        assert(primaryText.includes(`FAL_KEY=${fal}\n`), 'primary に同じ鍵がありません');
        assert((fs.statSync(primary).mode & 0o777) === 0o600, 'primary が 600 ではありません');
        assert(fs.readFileSync(legacy, 'utf8') === originalLegacy, 'legacy が変化しました');
        await screenshot(session.cdp, path.join(ROOT, '02-migrated.png'));
        return { copied: true, primaryMode: '600', legacyPreserved: true, badgeGone: true };
    });
    await check(2, async () => {
        const input = `${provider('groq')} input[type="password"]`;
        await waitEval(session.cdp, `Boolean(document.querySelector(${q(input)}))`, { label: 'groq key input' });
        await evalOn(session.cdp, `(()=>{const e=document.querySelector(${q(input)});e.value=${q(groq)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
        const save = await evalOn(session.cdp, `([...document.querySelectorAll(${q(provider('groq') + ' button')})]).find(b=>b.textContent.trim()==='保存')?.outerHTML`);
        assert(save, 'groq 保存ボタンがありません');
        await evalOn(session.cdp, `([...document.querySelectorAll(${q(provider('groq') + ' button')})]).find(b=>b.textContent.trim()==='保存').click()`);
        await waitEval(session.cdp, `Boolean(document.querySelector(${q(provider('groq') + ' .akari-set-key-tail')}))`, { label: 'groq 登録' });
        assert(fs.readFileSync(primary, 'utf8').includes(`GROQ_API_KEY=${groq}\n`), 'groq が primary にありません');
        assert(fs.readFileSync(legacy, 'utf8') === originalLegacy, 'legacy が変化しました');
        await screenshot(session.cdp, path.join(ROOT, '03-groq.png'));
        return { registered: true, primaryOnly: true, legacyPreserved: true };
    });
    await check(3, async () => {
        assert(fs.readFileSync(primary, 'utf8').includes(`DISCORD_RELEASE_WEBHOOK_URL=${webhook}\n`), '既存行が消えました');
        assert(fs.readFileSync(primary, 'utf8').includes('# existing\n'), '既存コメントが消えました');
        return { webhookPreserved: true, commentPreserved: true };
    });
    out.status = out.checks.every(item => item.pass) ? 'pass' : 'fail';
} catch (error) {
    out.status = 'fail';
    out.error = sanitize(error, REPO);
} finally {
    if (session) await stop(session);
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    await saveJson(RESULTS, out);
}
if (out.status !== 'pass') process.exitCode = 1;
