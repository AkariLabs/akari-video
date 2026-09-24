import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { CDP, evalOn, listTargets, realClick, screenshot } from '../../apps/shell/extensions/akari-annotations/evidence/ai-tab-shell/scripts/cdp-lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const shell = path.join(repo, 'apps/shell');
const scratch = await mkdtemp(path.join(tmpdir(), 'libcanvas-g1-l1-'));
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
const shotSettings = async (cdp, name) => {
    const rect = await evalOn(cdp, `(() => { const r=document.querySelector('[data-akari-settings-group="画像の AI"]')
        .getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } });
    await writeFile(path.join(here, name), Buffer.from(data, 'base64'));
};

await cp(path.join(repo, 'templates/project-default'), workspace, { recursive: true });
await mkdir(path.join(workspace, 'assets/still'), { recursive: true });
await mkdir(home, { recursive: true });
await cp(path.join(repo, 'templates/kaisetsu-short/sample-project/assets/dummy-shot.png'),
    path.join(workspace, 'assets/still/photo.png'));
const edit = { version: 2, output: { width: 1280, height: 720, fps: 30 },
    sources: [{ id: 'photo', path: 'assets/still/photo.png' }],
    tracks: [{ id: 'visual-main', lane: 'visual', items: [
        { id: 'photo-1', at: 0, duration: 180, source: { kind: 'media', src: 'photo', in: 0, out: 6 } }
    ] }], audio: { narration: [], sfx: [] } };
await writeFile(path.join(workspace, 'edit.json'), `${JSON.stringify(edit, null, 2)}\n`);
const electron = path.join(shell, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const child = spawn(electron, [shell, workspace, `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`, '--no-sandbox'], { cwd: shell,
    env: { ...process.env, AKARI_HOME: home, THEIA_CONFIG_DIR: path.join(scratch, 'theia-config') },
    stdio: ['ignore', 'pipe', 'pipe'] });
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
        void window.theia.container.get(C).executeCommand(${JSON.stringify(id)}, ${JSON.stringify(arg)}); return true; })()`;
    await wait(cdp, `(() => { const e=document.querySelector('.theia-preload');
        return !e || getComputedStyle(e).display==='none' || Number(getComputedStyle(e).opacity)===0; })()`, 'workbench ready');
    await wait(cdp, command('akari.settings.open', { section: 'connections' }), 'settings command', 300000);
    await wait(cdp, `!!document.querySelector('[data-akari-settings-dialog]')`, 'settings dialog');
    await evalOn(cdp, `document.querySelector('[data-settings-nav="connections"]')?.click()`);
    await wait(cdp, `!!document.querySelector('[data-akari-image-ai-status="unconfigured"]')`, 'key missing');
    check('key missing shown', true, 'unconfigured');
    await shotSettings(cdp, '01-key-missing.png');
    await evalOn(cdp, `(() => { const input=document.querySelector('input[aria-label="画像のキー"]');
        input.value='l1-test-key'; input.dispatchEvent(new Event('input',{bubbles:true}));
        const card=input.closest('[data-akari-settings-group]');
        [...card.querySelectorAll('button')].find(b=>b.textContent==='保存').click(); return true; })()`);
    await wait(cdp, `!!document.querySelector('[data-akari-image-ai-status="configured"]')`, 'key saved');
    check('key saved through settings UI', true, 'configured');
    await shotSettings(cdp, '02-key-saved.png');
    const saved = await readFile(path.join(home, 'credentials.env'), 'utf8');
    check('dedicated key stored in credentials file', saved.includes('AKARI_IMAGE_AI_FAL_KEY=l1-test-key'), 'yes');
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await evalOn(cdp, command('akari.annotations.open'));
    await wait(cdp, `!!document.querySelector('[data-akari-ui="timeline:cut:0"]')`, 'timeline cut');
    await evalOn(cdp, command('akari.inspector.open'));
    await wait(cdp, `!!document.querySelector('[data-akari-ui="panel:inspector"]')`, 'inspector');
    await click(cdp, '[data-akari-ui="timeline:cut:0"]');
    await click(cdp, '[data-akari-ui="tab:inspector-generation"]');
    await wait(cdp, `!!document.querySelector('[data-akari-image-ai-panel="photo-1"] button')`, 'upscale entry');
    await click(cdp, '[data-akari-image-ai-panel="photo-1"] button');
    const confirmation = await wait(cdp, `(() => { const p=document.querySelector('[data-akari-image-ai-panel="photo-1"]');
        const t=p?.textContent||''; return t.includes('送る画像:') && t.includes('送信先: fal')
            && t.includes('料金の目安:') && t.includes('送って高画質化') ? t : null; })()`, 'confirmation');
    check('confirmation shows image, destination and price before send', true,
        confirmation.replace(/\s+/g, ' ').slice(0, 240));
    await screenshot(cdp, path.join(here, '03-before-send.png'));
    check('no paid request started', !output.includes('queue.fal.run'), 'send button was not pressed');
    await evalOn(cdp, `(() => { const p=document.querySelector('[data-akari-image-ai-panel="photo-1"]');
        [...p.querySelectorAll('button')].find(b=>b.textContent==='戻る').click(); return true; })()`);
    const cut = await evalOn(cdp, `(() => { const r=document.querySelector('[data-akari-ui="timeline:cut:0"]')
        .getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...cut, button: 'right', buttons: 2, clickCount: 1 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...cut, button: 'right', buttons: 0, clickCount: 1 });
    await wait(cdp, `!!document.querySelector('[data-akari-context-item="image-ai-upscale"]')`, 'right click option');
    check('right click offers upscale', true, '高画質化');
    await evalOn(cdp, `document.querySelector('[data-akari-context-item="image-ai-upscale"]').click()`);
    await wait(cdp, `document.querySelector('[data-akari-image-ai-panel="photo-1"]')?.textContent.includes('送る画像:')`,
        'right click opens confirmation');
    check('right click opens the same confirmation', true, 'confirmed');
} catch (error) {
    checks.push({ name: 'L1 failure', pass: false, detail: String(error).replaceAll(repo, '<WORKTREE>').replaceAll(scratch, '<TMP>') });
    throw error;
} finally {
    cdp?.close();
    if (!exited) child.kill('SIGTERM');
    await Promise.race([closed, sleep(15000)]);
    if (!exited) child.kill('SIGKILL');
    await writeFile(path.join(here, 'results.json'), `${JSON.stringify({ checks }, null, 2)}\n`);
    await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 1000 });
}
