// Supplementary L1 written by the lane wrapper (verification only).
// Covers what verify-l1.mjs does not: the inspector without a key (「設定を開く」),
// and adopting a saved alternative → source swap → one undo restores the original.
// No request is sent to the service: the alternative is a local fixture.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from '../../apps/shell/extensions/akari-annotations/evidence/ai-tab-shell/scripts/cdp-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const shell = path.join(repo, 'apps/shell');
const require = createRequire(import.meta.url);
const { imageAiEditVersion } = require(path.join(shell, 'extensions/akari-annotations/lib/common/image-ai-binding.js'));
const scratch = await mkdtemp(path.join(tmpdir(), 'libcanvas-g1-l1w-'));
const workspace = path.join(scratch, 'project');
const home = path.join(scratch, 'akari-home');
const profile = path.join(scratch, 'user-data');
const port = 9549;
const checks = [];
const check = (name, pass, detail) => { checks.push({ name, pass, detail }); assert.ok(pass, name); };
const wait = async (cdp, expression, label, ms = 120000) => {
    const until = Date.now() + ms;
    while (Date.now() < until) {
        const value = await evalOn(cdp, expression).catch(() => undefined);
        if (value) return value;
        await sleep(300);
    }
    throw new Error(`Timed out: ${label}`);
};
const click = async (cdp, selector) => {
    const point = await wait(cdp, `(() => { const e=document.querySelector(${JSON.stringify(selector)});
        if (!e) return null; e.scrollIntoView({block:'center'}); const r=e.getBoundingClientRect();
        return r.width && r.height ? {x:r.x+r.width/2,y:r.y+r.height/2} : null; })()`, selector);
    await realClick(cdp, point.x, point.y);
};
const panelButton = label => `(() => { const p=document.querySelector('[data-akari-image-ai-panel="photo-1"]');
    const b=p && [...p.querySelectorAll('button')].find(x=>x.textContent===${JSON.stringify(label)});
    if (!b || b.disabled) return false; b.click(); return true; })()`;

await cp(path.join(repo, 'templates/project-default'), workspace, { recursive: true });
await mkdir(path.join(workspace, 'assets/still'), { recursive: true });
await mkdir(home, { recursive: true });
const photo = path.join(workspace, 'assets/still/photo.png');
await cp(path.join(repo, 'templates/kaisetsu-short/sample-project/assets/dummy-shot.png'), photo);
const edit = { version: 2, output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'photo', path: 'assets/still/photo.png' }],
    tracks: [{ id: 'visual-main', lane: 'visual', items: [
        { id: 'photo-1', at: 0, duration: 180, source: { kind: 'media', src: 'photo', in: 0, out: 6 } }
    ] }], audio: { narration: [], sfx: [] } };
await writeFile(path.join(workspace, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
// A previously saved alternative (fixture): any image bytes stand in for the service output.
const inputBytes = await readFile(photo);
const altBytes = Buffer.concat([inputBytes]);
const altHash = createHash('sha256').update(altBytes).digest('hex');
const altRelative = `assets/generated/${altHash}.png`;
await mkdir(path.join(workspace, 'assets/generated'), { recursive: true });
await writeFile(path.join(workspace, altRelative), altBytes);
await writeFile(path.join(workspace, `${altRelative}.meta.json`), `${JSON.stringify({
    provider: 'fal', model: 'fal-ai/clarity-upscaler', item_id: 'photo-1', operation: 'upscale',
    input_sha256: createHash('sha256').update(inputBytes).digest('hex'),
    edit_version: imageAiEditVersion(edit, 'photo-1'),
    parameters: { upscale_factor: 2, enable_safety_checker: true }, created_at: new Date().toISOString()
}, null, 2)}\n`);

const electron = path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const env = { ...process.env, AKARI_HOME: home, THEIA_CONFIG_DIR: path.join(scratch, 'theia-config') };
delete env.FAL_KEY;
const child = spawn(electron, [shell, workspace, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], { cwd: shell, env, stdio: ['ignore', 'pipe', 'pipe'] });
let exited = false;
let output = '';
child.stdout.on('data', chunk => { output += chunk; });
child.stderr.on('data', chunk => { output += chunk; });
child.on('exit', () => { exited = true; });
const closed = new Promise(resolve => child.once('exit', resolve));
let cdp;
try {
    for (let attempt = 0; attempt < 240; attempt++) {
        if (exited) throw new Error('Electron exited before UI appeared');
        try {
            const target = (await listTargets(port)).find(row => row.type === 'page');
            if (target) { cdp = new CDP(target.webSocketDebuggerUrl); await cdp.connect();
                if (await evalOn(cdp, '!!window.theia?.container')) break; cdp.close(); cdp = undefined; }
        } catch { /* Starting. */ }
        await sleep(500);
    }
    assert.ok(cdp, 'Electron UI did not load');
    await cdp.send('Page.enable');
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => undefined);
    await cdp.send('Page.bringToFront');
    const command = (id, arg) => `(async () => { const C=[...window.theia.container._bindingDictionary._map.keys()]
        .find(k => typeof k==='function' && typeof k.prototype?.executeCommand==='function');
        void window.theia.container.get(C).executeCommand(${JSON.stringify(id)}${arg === undefined ? '' : `, ${JSON.stringify(arg)}`}); return true; })()`;
    await wait(cdp, `(() => { const e=document.querySelector('.theia-preload');
        return !e || getComputedStyle(e).display==='none' || Number(getComputedStyle(e).opacity)===0; })()`, 'workbench ready');
    await wait(cdp, command('akari.annotations.open'), 'timeline command', 300000);
    await wait(cdp, `!!document.querySelector('[data-akari-ui="timeline:cut:0"]')`, 'timeline cut');
    await evalOn(cdp, command('akari.inspector.open'));
    await wait(cdp, `!!document.querySelector('[data-akari-ui="panel:inspector"]')`, 'inspector');
    await click(cdp, '[data-akari-ui="timeline:cut:0"]');
    await click(cdp, '[data-akari-ui="tab:inspector-generation"]');
    await wait(cdp, panelButton('高画質化'), 'upscale entry');
    const noKey = await wait(cdp, `(() => { const p=document.querySelector('[data-akari-image-ai-panel="photo-1"]');
        const t=p?.textContent||''; if (!t.includes('キーを設定すると使えます')) return null;
        const send=[...p.querySelectorAll('button')].find(b=>b.textContent==='送って高画質化');
        const settings=[...p.querySelectorAll('button')].some(b=>b.textContent==='設定を開く');
        return { text: t.replace(/\\s+/g,' '), sendDisabled: !send || send.disabled, settings }; })()`, 'no key confirmation');
    check('no key: panel says a key is needed', true, noKey.text.slice(0, 200));
    check('no key: send is disabled', noKey.sendDisabled, String(noKey.sendDisabled));
    check('no key: open-settings button shown', noKey.settings, String(noKey.settings));
    check('panel text has no "AI"', !/AI/.test(noKey.text), noKey.text.slice(0, 200));
    await screenshot(cdp, path.join(here, '04-no-key-panel.png'));
    await wait(cdp, panelButton('設定を開く'), 'open settings');
    await wait(cdp, `!!document.querySelector('[data-akari-settings-dialog]')`, 'settings dialog');
    check('open-settings opens the settings dialog', true, 'dialog');
    const settingsAi = await wait(cdp, `(() => { const g=document.querySelector('[data-akari-settings-group="画像の AI"]');
        if (!g) return null; return (g.textContent||'').replace(/\\s+/g,' '); })()`, 'image group');
    check('settings group: "AI" appears only in the heading', (settingsAi.match(/AI/g) || []).length === 1, settingsAi.slice(0, 200));
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await wait(cdp, `!document.querySelector('[data-akari-settings-dialog]')`, 'settings closed');
    // A saved alternative is offered without sending again.
    await click(cdp, '[data-akari-ui="timeline:cut:0"]');
    await wait(cdp, `(() => { const p=document.querySelector('[data-akari-image-ai-panel="photo-1"]');
        return !!p && [...p.querySelectorAll('button')].some(b=>b.textContent==='この案にする'); })()`, 'saved alternative offered');
    check('saved alternative offered after reload without sending', !output.includes('queue.fal.run'), 'この案にする');
    await screenshot(cdp, path.join(here, '05-saved-alternative.png'));
    await wait(cdp, panelButton('この案にする'), 'adopt');
    const adopted = await (async () => {
        const until = Date.now() + 30000;
        while (Date.now() < until) {
            const doc = JSON.parse(await readFile(path.join(workspace, 'edit.json'), 'utf8'));
            const src = doc.tracks[0].items[0].source.src;
            const row = doc.sources.find(r => r.id === src);
            if (row?.path === altRelative) return doc;
            await sleep(300);
        }
        return null;
    })();
    check('adopt swaps the item source to the alternative', !!adopted, adopted ? 'assets/generated/<sha256>.png' : 'not swapped');
    check('original file remains', (await readFile(photo)).equals(inputBytes), 'assets/still/photo.png');
    check('edit.json holds no key or temporary URL', !/https?:|KEY/i.test(JSON.stringify(adopted)), 'clean');
    await click(cdp, '[data-akari-ui="timeline:cut:0"]');
    await evalOn(cdp, command('akari.timeline.undo'));
    const restored = await (async () => {
        const until = Date.now() + 30000;
        while (Date.now() < until) {
            const doc = JSON.parse(await readFile(path.join(workspace, 'edit.json'), 'utf8'));
            const row = doc.sources.find(r => r.id === doc.tracks[0].items[0].source.src);
            if (row?.path === 'assets/still/photo.png') return true;
            await sleep(300);
        }
        return false;
    })();
    check('one undo restores the original source', restored, String(restored));
} catch (error) {
    checks.push({ name: 'L1 failure', pass: false, detail: String(error).replaceAll(repo, '<WORKTREE>').replaceAll(scratch, '<TMP>') });
    throw error;
} finally {
    cdp?.close();
    if (!exited) child.kill('SIGTERM');
    await Promise.race([closed, sleep(15000)]);
    if (!exited) child.kill('SIGKILL');
    await writeFile(path.join(here, 'results-wrapper.json'), `${JSON.stringify({ checks }, null, 2)}\n`);
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 1000 });
}
