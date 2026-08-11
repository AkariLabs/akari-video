import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
    connectMain,
    evalMain,
    realClick,
    sleep,
    toggleDeveloperModeViaSettings
} from '../../../akari-shell-strip/evidence/quick-export/cdp-lib.mjs';

const [, , portArgument, workspaceDir, evidenceDir] = process.argv;
const cdpPort = Number(portArgument);
if (!Number.isInteger(cdpPort) || !workspaceDir || !evidenceDir) {
    throw new Error('usage: node review-session-consecutive-clicks.mjs <cdp-port> <workspace-dir> <evidence-dir>');
}

const log = [];
const record = (step, detail = {}) => log.push({ at: new Date().toISOString(), step, ...detail });

async function waitFor(expression, description, timeoutMs = 20_000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        const value = await evalMain(main, expression);
        if (value) {
            return value;
        }
        await sleep(250);
    }
    throw new Error(`timed out waiting for ${description}`);
}

const elementCenter = selector => `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2,
        width: rect.width, height: rect.height, text: element.textContent?.trim() ?? '' };
})()`;

await mkdir(evidenceDir, { recursive: true });
const main = await connectMain(cdpPort);
try {
    record('connected');
    const microphone = await evalMain(main, `(async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            stream.getTracks().forEach(track => track.stop());
            return { ok: true };
        } catch (error) {
            return { ok: false, name: error?.name ?? '', message: error?.message ?? String(error) };
        }
    })()`);
    record('microphone-preflight', microphone);
    assert.equal(microphone.ok, true, `microphone preflight failed: ${JSON.stringify(microphone)}`);

    const developerMode = await toggleDeveloperModeViaSettings(main);
    record('developer-mode', developerMode);
    assert.equal(developerMode.checkedAfter, true);

    const explorerState = await waitFor(`(() => {
        const anyVisibleRow = Array.from(document.querySelectorAll('.theia-TreeNode'))
            .find(element => element.getBoundingClientRect().width > 0);
        const icon = Array.from(document.querySelectorAll('.codicon-files'))
            .find(element => element.getBoundingClientRect().width > 0);
        if (!icon) return null;
        const rect = icon.getBoundingClientRect();
        return {
            alreadyOpen: !!anyVisibleRow,
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2
        };
    })()`, 'Explorer activity bar icon');
    if (!explorerState.alreadyOpen) {
        await realClick(main, explorerState.x, explorerState.y);
        await waitFor(`Array.from(document.querySelectorAll('.theia-TreeNode'))
            .some(element => element.getBoundingClientRect().width > 0)`, 'open Explorer panel');
    }
    record('explorer-open', explorerState);

    const editRow = await waitFor(`(() => {
        const row = Array.from(document.querySelectorAll('.theia-TreeNode'))
            .find(element => element.textContent?.trim() === 'edit.json');
        if (!row) return null;
        const rect = row.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0
            ? { x: rect.left + 24, y: rect.top + rect.height / 2 }
            : null;
    })()`, 'edit.json Explorer row');
    await realClick(main, editRow.x, editRow.y, { clickCount: 2 });

    const reviewPanelTab = await waitFor(`(() => {
        const tabs = Array.from(document.querySelectorAll('.lm-TabBar-tab'));
        const tab = document.getElementById('shell-tab-akari-review-panel-widget')
            ?? tabs.find(element => {
                const label = element.querySelector('.lm-TabBar-tabLabel')?.textContent?.trim();
                return label === '注釈'
                    || element.getAttribute('title')?.includes('注釈')
                    || element.getAttribute('aria-label')?.includes('注釈');
            });
        if (!tab) return null;
        const rect = tab.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        return {
            alreadyCurrent: tab.classList.contains('lm-mod-current'),
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
            id: tab.id,
            label: tab.querySelector('.lm-TabBar-tabLabel')?.textContent?.trim() ?? ''
        };
    })()`, 'annotation panel tab');
    if (!reviewPanelTab.alreadyCurrent) {
        await realClick(main, reviewPanelTab.x, reviewPanelTab.y);
        await waitFor(`document.getElementById('shell-tab-akari-review-panel-widget')
            ?.classList.contains('lm-mod-current')`, 'activate annotation panel tab');
    }
    record('review-panel-open', reviewPanelTab);

    const cut0 = await waitFor(elementCenter('[data-akari-ui="timeline:cut:0"]'), 'timeline:cut:0');
    const cut1 = await waitFor(elementCenter('[data-akari-ui="timeline:cut:1"]'), 'timeline:cut:1');
    record('timeline-ready', { cut0, cut1 });

    const recordingButton = await waitFor(elementCenter('[data-review-recording-toggle]'), 'recording button');
    await realClick(main, recordingButton.x, recordingButton.y);
    await waitFor(`document.querySelector('[data-review-recording-toggle]')?.textContent === '録音終了'`, 'recording start');
    record('recording-started');

    const selectButton = await waitFor(elementCenter('[data-review-tool-mode-button="select"]'), 'select tool button');
    await realClick(main, selectButton.x, selectButton.y);
    await waitFor(`document.querySelector('[data-review-tool-mode-button="select"]')?.getAttribute('aria-pressed') === 'true'`, 'select tool activation');
    record('select-tool-active');

    await realClick(main, cut0.x, cut0.y);
    await sleep(50);
    const cut1AfterFirstClick = await waitFor(elementCenter('[data-akari-ui="timeline:cut:1"]'), 'timeline:cut:1 after first click');
    await realClick(main, cut1AfterFirstClick.x, cut1AfterFirstClick.y);
    record('consecutive-real-clicks', { cut0, cut1: cut1AfterFirstClick, intervalMs: 50 });
    await sleep(300);

    const stopButton = await waitFor(elementCenter('[data-review-recording-toggle]'), 'recording stop button');
    await realClick(main, stopButton.x, stopButton.y);
    await waitFor(`document.querySelector('[data-review-recording-toggle]')?.textContent === '録音開始'`, 'recording stop');
    record('recording-stopped');

    const sessionsDir = path.join(workspaceDir, 'review', 'sessions');
    const sessionIds = (await readdir(sessionsDir)).filter(name => name.startsWith('s-')).sort();
    assert.ok(sessionIds.length > 0, 'no recorded session directory found');
    const eventsPath = path.join(sessionsDir, sessionIds.at(-1), 'events.jsonl');
    const eventsText = await readFile(eventsPath, 'utf8');
    const events = eventsText.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const clicks = events.filter(event => event.type === 'ui.click'
        && (event.target === 'timeline:cut:0' || event.target === 'timeline:cut:1'));
    record('events-read', { sessionId: sessionIds.at(-1), clicks });
    assert.deepEqual(clicks.map(event => event.target), ['timeline:cut:0', 'timeline:cut:1']);
    assert.ok(clicks.every(event => event.intent === true));

    await copyFile(eventsPath, path.join(evidenceDir, 'events.jsonl'));
    await writeFile(path.join(evidenceDir, 'run-log.json'), `${JSON.stringify(log, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({ ok: true, sessionId: sessionIds.at(-1), clicks }, null, 2)}\n`);
} finally {
    main.close();
}
