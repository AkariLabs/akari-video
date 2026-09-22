// partner-brand-icons L1 検証本体（ラッパー自身が Write した検証用スクリプト）。
// 1 回の起動で dark / light の両テーマについて:
//   - 右「パートナーを追加」パネル: 各ボタンのアイコンの computed（background-color /
//     background-image / mask-image）、caution の有無、h2 見出しの可視性を実測してスクショ
//   - BEFORE: 注入済み style#akari-partner-terminal-icons の中身を 7276a4ed の
//     PARTNER_TERMINAL_CSS（before-partner-terminal.css — git show から評価した出力）へ
//     差し替えて同じ画面を撮り、Grok / Cursor / OpenCode / Command Code の computed が
//     AFTER と一致することを確認（アイコンの見え方はこの CSS だけで決まるため）
//   - 左カタログ: アイコン computed と caution の有無
//   - パートナーのターミナルタブ（右エリア。本物と同じ iconClass で newTerminal して再現）:
//     選択中・非選択・ホバー中の computed
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, evalMain, screenshot, sleep } from './cdp-lib.mjs';

const [, , portArg, evidenceDir] = process.argv;
const port = Number(portArg);
const beforeCss = await readFile(new URL('./before-partner-terminal.css', import.meta.url), 'utf8');
const AGENTS = ['claude', 'codex', 'opencode', 'commandcode', 'copilot', 'cursor', 'antigravity', 'grok'];
const UNCHANGED = ['grok', 'cursor', 'opencode', 'commandcode'];
const log = { measurements: {}, checks: [] };
const check = (name, ok, data) => {
  log.checks.push({ name, ok, ...(data === undefined ? {} : { data }) });
  console.log(ok ? 'PASS' : 'FAIL', name, data === undefined ? '' : JSON.stringify(data).slice(0, 400));
};

const cdp = await connectMain(port);
for (let i = 0; i < 120; i++) {
  if (await evalMain(cdp, '!!(window.theia && window.theia.container) && !!document.querySelector("[data-partner-entry]")')) break;
  await sleep(1000);
}

const PRELUDE = `
  const bindings = window.theia.container._bindingDictionary;
  const find = pred => [...bindings._map.keys()].find(key => typeof key === 'function' && pred(key.prototype || {}));
  const get = pred => window.theia.container.get(find(pred));
  const shell = get(p => typeof p.addWidget === 'function' && typeof p.activateWidget === 'function' && typeof p.revealWidget === 'function');
  const themes = get(p => typeof p.setCurrentTheme === 'function');
  const terminals = get(p => typeof p.newTerminal === 'function');
`;
const inTheia = body => evalMain(cdp, `(async () => { ${PRELUDE} ${body} })()`, 30000);

async function setTheme(id) {
  await inTheia(`themes.setCurrentTheme(${JSON.stringify(id)}, false); return true;`);
  await sleep(1500);
}

const ICON_PROPS = `el => {
  const cs = getComputedStyle(el);
  const agent = [...el.classList].map(c => c.match(/^akari-partner-(.+)-cli-icon$/)).find(Boolean)?.[1];
  const trim = v => v === 'none' ? 'none' : v.slice(0, 40) + '…(' + v.length + ')';
  return { agent, backgroundColor: cs.backgroundColor, backgroundImage: trim(cs.backgroundImage),
    maskImage: trim(cs.maskImage || cs.webkitMaskImage), color: cs.color, width: cs.width, height: cs.height };
}`;

async function measurePanel() {
  return evalMain(cdp, `(() => {
    const root = document.getElementById('akari-partner-onboarding');
    const icon = ${ICON_PROPS};
    const buttons = [...root.querySelectorAll('[data-partner-entry]')].map(b => {
      const el = b.querySelector('[class*="-cli-icon"]');
      return { entry: b.getAttribute('data-partner-entry'), main: b.classList.contains('main'),
        buttonBg: getComputedStyle(b).backgroundColor,
        iconParentBg: el ? getComputedStyle(el.parentElement).backgroundColor : null, icon: el ? icon(el) : null };
    });
    const headings = [...root.querySelectorAll('h1,h2,h3')].map(h => ({ text: h.textContent,
      visibility: getComputedStyle(h).visibility, display: getComputedStyle(h).display }));
    return {
      editorForeground: getComputedStyle(document.body).getPropertyValue('--theia-editor-foreground').trim(),
      buttons, headings,
      cautionNodes: root.querySelectorAll('[data-partner-caution]').length,
      cautionTextVisible: root.innerText.includes('拡張ホストが再起動すると会話が切れます'),
      visibleHeadingText: ['パートナーを追加', 'パートナー接続済み'].filter(t => [...root.querySelectorAll('*')]
        .some(n => n.childNodes.length === 1 && n.textContent === t && getComputedStyle(n).visibility === 'visible' && n.getBoundingClientRect().height > 0)),
      rect: (() => { const r = root.getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()
    };
  })()`);
}

async function clipShot(file, rect) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', clip: { ...rect, scale: 1 } }, 20000);
  await writeFile(path.join(evidenceDir, file), Buffer.from(data, 'base64'));
}

async function measureCatalog() {
  await inTheia(`await shell.activateWidget('vsx-extensions-view-container'); return true;`);
  await sleep(1200);
  return evalMain(cdp, `(() => {
    const root = document.querySelector('[data-akari-catalog-count]');
    if (!root) return null;
    const icon = ${ICON_PROPS};
    const r = root.getBoundingClientRect();
    return {
      icons: [...root.querySelectorAll('[class*="-cli-icon"]')].map(icon),
      cautionNodes: document.querySelectorAll('#vsx-extensions-view-container [data-partner-caution]').length,
      cautionTextVisible: root.innerText.includes('拡張ホストが再起動すると会話が切れます'),
      rect: { x: r.left, y: r.top, width: r.width, height: Math.min(r.height, 900) }
    };
  })()`);
}

async function panelPhase(theme) {
  await inTheia(`await shell.activateWidget('akari-partner-onboarding'); return true;`);
  await sleep(1200);
  const after = await measurePanel();
  log.measurements[`${theme}-panel-after`] = after;
  await clipShot(`${theme}-add-partner-AFTER.png`, after.rect);

  // BEFORE: 同じ DOM に 7276a4ed の CSS を当て直して撮る → 元へ戻す
  const current = await evalMain(cdp, `document.getElementById('akari-partner-terminal-icons').textContent`);
  await evalMain(cdp, `(() => { document.getElementById('akari-partner-terminal-icons').textContent = ${JSON.stringify(beforeCss)}; return true; })()`);
  await sleep(600);
  const before = await measurePanel();
  log.measurements[`${theme}-panel-before-css`] = before;
  await clipShot(`${theme}-add-partner-BEFORE-icons.png`, before.rect);
  await evalMain(cdp, `(() => { document.getElementById('akari-partner-terminal-icons').textContent = ${JSON.stringify(current)}; return true; })()`);
  await sleep(600);

  const byAgent = m => Object.fromEntries(m.buttons.filter(b => b.icon).map(b => [b.icon.agent, b.icon]));
  const a = byAgent(after), b = byAgent(before);
  check(`${theme}: 8 エージェント全部のアイコンがボタンにある`, AGENTS.every(x => a[x]), Object.keys(a));
  check(`${theme}: Claude = rgb(217, 119, 87) 単色 mask`, a.claude.backgroundColor === 'rgb(217, 119, 87)' && a.claude.maskImage !== 'none', a.claude);
  const mainClaude = after.buttons.find(b => b.entry === 'anthropic/claude-code-cli');
  check(`${theme}: 推奨（塗り）ボタンの Claude アイコンに下地がありボタン色と別`, mainClaude.main && mainClaude.iconParentBg !== 'rgba(0, 0, 0, 0)' && mainClaude.iconParentBg !== mainClaude.buttonBg,
    { buttonBg: mainClaude.buttonBg, backing: mainClaude.iconParentBg, icon: mainClaude.icon.backgroundColor });
  check(`${theme}: Antigravity = background-image の多色 SVG・mask なし・背景色透明`,
    a.antigravity.backgroundImage.startsWith('url("data:image/svg+xml') && a.antigravity.maskImage === 'none' && a.antigravity.backgroundColor === 'rgba(0, 0, 0, 0)', a.antigravity);
  for (const x of ['codex', 'copilot']) {
    check(`${theme}: ${x} = テーマの文字色（--theia-editor-foreground ${after.editorForeground}）`, a[x].maskImage !== 'none', a[x]);
  }
  for (const x of UNCHANGED) {
    const same = JSON.stringify(a[x]) === JSON.stringify(b[x]);
    check(`${theme}: ${x} の computed が BEFORE CSS と一致`, same, same ? a[x] : { after: a[x], before: b[x] });
  }
  check(`${theme}: 注意書きが partner-widget に無い`, after.cautionNodes === 0 && !after.cautionTextVisible, { nodes: after.cautionNodes });
  check(`${theme}: 「パートナーを追加」「パートナー接続済み」の見出しが見えない`, after.visibleHeadingText.length === 0, after.headings);

  const catalog = await measureCatalog();
  log.measurements[`${theme}-catalog`] = catalog;
  check(`${theme}: 左カタログに注意書きが無い`, catalog && catalog.cautionNodes === 0 && !catalog.cautionTextVisible, catalog && { nodes: catalog.cautionNodes });
  const c = Object.fromEntries((catalog?.icons ?? []).map(i => [i.agent, i]));
  check(`${theme}: 左カタログのアイコンもボタンと同じ computed`, AGENTS.every(x => c[x] && c[x].backgroundColor === a[x].backgroundColor && c[x].backgroundImage === a[x].backgroundImage && c[x].maskImage === a[x].maskImage),
    Object.fromEntries(AGENTS.map(x => [x, c[x]?.backgroundColor])));
  await clipShot(`${theme}-left-catalog.png`, catalog.rect);
  return a;
}

async function ensureTerminals() {
  return inTheia(`
    window.__brandTerms = window.__brandTerms || [];
    if (!window.__brandTerms.length) {
      const names = { claude: 'Claude Code CLI', codex: 'Codex CLI', opencode: 'opencode CLI', commandcode: 'Command Code CLI',
        copilot: 'Copilot CLI', cursor: 'Cursor CLI', antigravity: 'Antigravity CLI', grok: 'Grok Build CLI' };
      for (const agent of ${JSON.stringify(AGENTS)}) {
        const t = await terminals.newTerminal({ title: names[agent], iconClass: 'akari-partner-' + agent + '-cli-icon',
          shellPath: '/bin/cat', shellArgs: [], useServerTitle: false, destroyTermOnClose: true });
        await shell.addWidget(t, { area: 'right', rank: 50 });
        window.__brandTerms.push(t);
      }
    }
    return window.__brandTerms.length;
  `);
}

async function measureTabs() {
  return evalMain(cdp, `(() => {
    const icon = ${ICON_PROPS};
    return [...document.querySelectorAll('.lm-TabBar-tab')].map(tab => {
      const el = tab.querySelector('[class*="akari-partner-"][class*="-cli-icon"]');
      if (!el || tab.getBoundingClientRect().width === 0) return null;
      const r = tab.getBoundingClientRect();
      return { current: tab.classList.contains('lm-mod-current'), active: tab.classList.contains('theia-mod-active'),
        rect: { x: r.left, y: r.top, width: r.width, height: r.height }, icon: icon(el) };
    }).filter(Boolean);
  })()`);
}

async function tabsPhase(theme, panelIcons) {
  await ensureTerminals();
  const results = {};
  for (const agent of ['claude', 'antigravity', 'codex']) {
    await inTheia(`const t = window.__brandTerms.find(t => t.title.iconClass === 'akari-partner-${agent}-cli-icon'); await shell.activateWidget(t.id); return true;`);
    await sleep(900);
    const tabs = await measureTabs();
    const selected = tabs.find(t => t.icon.agent === agent);
    results[`${agent}-selected`] = selected;
    check(`${theme}: 選択中タブ（${agent}）のアイコン computed がボタンと同じ`, selected && selected.current
      && selected.icon.backgroundColor === panelIcons[agent].backgroundColor && selected.icon.backgroundImage === panelIcons[agent].backgroundImage,
      selected && { current: selected.current, active: selected.active, bg: selected.icon.backgroundColor, img: selected.icon.backgroundImage });
  }
  // ホバー: 選択中（codex）以外の claude タブの上にマウスを置いて測る
  let tabs = await measureTabs();
  const claudeTab = tabs.find(t => t.icon.agent === 'claude');
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: claudeTab.rect.x + claudeTab.rect.width / 2, y: claudeTab.rect.y + claudeTab.rect.height / 2, button: 'none' });
  await sleep(500);
  tabs = await measureTabs();
  const hovered = tabs.find(t => t.icon.agent === 'claude');
  results['claude-hover-unselected'] = hovered;
  check(`${theme}: ホバー中・非選択タブ（claude）もオレンジ`, hovered.icon.backgroundColor === 'rgb(217, 119, 87)', hovered.icon);
  const all = Object.fromEntries(tabs.map(t => [t.icon.agent, t.icon]));
  // 色を変えた 4 種はボタンと同じ見え方（色・画像）。サイドのタブは Theia が 48px 枠 + 24px マスクで描くので寸法は比較しない
  const CHANGED = AGENTS.filter(x => !UNCHANGED.includes(x));
  check(`${theme}: Claude / Codex / Copilot / Antigravity のタブアイコンがボタンと同じ色・画像`, CHANGED.every(x => all[x] && all[x].backgroundColor === panelIcons[x].backgroundColor && all[x].backgroundImage === panelIcons[x].backgroundImage),
    Object.fromEntries(CHANGED.map(x => [x, [all[x]?.backgroundColor, all[x]?.backgroundImage]])));
  // 変えない 4 種は、タブ上でも BEFORE CSS の computed と一致（Theia のサイドタブの灰色/白の切り替えも含め BEFORE のまま）
  const current = await evalMain(cdp, `document.getElementById('akari-partner-terminal-icons').textContent`);
  await evalMain(cdp, `(() => { document.getElementById('akari-partner-terminal-icons').textContent = ${JSON.stringify(beforeCss)}; return true; })()`);
  await sleep(600);
  const beforeTabs = await measureTabs();
  {
    const b = tabs.reduce((acc, t) => ({ x0: Math.min(acc.x0, t.rect.x), y0: Math.min(acc.y0, t.rect.y), x1: Math.max(acc.x1, t.rect.x + t.rect.width), y1: Math.max(acc.y1, t.rect.y + t.rect.height) }), { x0: 1e9, y0: 1e9, x1: 0, y1: 0 });
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
    await sleep(400);
    await clipShot(`${theme}-partner-terminal-tabs-BEFORE-icons.png`, { x: b.x0 - 4, y: b.y0 - 4, width: b.x1 - b.x0 + 8, height: b.y1 - b.y0 + 8 });
  }
  await evalMain(cdp, `(() => { document.getElementById('akari-partner-terminal-icons').textContent = ${JSON.stringify(current)}; return true; })()`);
  await sleep(600);
  const bt = Object.fromEntries(beforeTabs.map(t => [t.icon.agent, t.icon]));
  for (const x of UNCHANGED) {
    const same = JSON.stringify(all[x]) === JSON.stringify(bt[x]);
    check(`${theme}: ${x} のタブアイコン computed が BEFORE CSS と一致`, same, same ? all[x].backgroundColor : { after: all[x], before: bt[x] });
  }
  log.measurements[`${theme}-tabs`] = { results, tabs, beforeCssTabs: beforeTabs };
  // 右エリアのタブ列を撮る（選択中 = codex）。タブ列の外接矩形
  const bar = tabs.reduce((acc, t) => ({ x0: Math.min(acc.x0, t.rect.x), y0: Math.min(acc.y0, t.rect.y), x1: Math.max(acc.x1, t.rect.x + t.rect.width), y1: Math.max(acc.y1, t.rect.y + t.rect.height) }), { x0: 1e9, y0: 1e9, x1: 0, y1: 0 });
  await clipShot(`${theme}-partner-terminal-tabs.png`, { x: bar.x0 - 4, y: bar.y0 - 4, width: bar.x1 - bar.x0 + 8, height: bar.y1 - bar.y0 + 8 });
  // Claude を選択中にした状態も撮る
  await inTheia(`const t = window.__brandTerms.find(t => t.title.iconClass === 'akari-partner-claude-cli-icon'); await shell.activateWidget(t.id); return true;`);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5, button: 'none' });
  await sleep(900);
  await clipShot(`${theme}-partner-terminal-tabs-claude-selected.png`, { x: bar.x0 - 4, y: bar.y0 - 4, width: bar.x1 - bar.x0 + 8, height: bar.y1 - bar.y0 + 8 });
}

for (const theme of ['dark', 'light']) {
  await setTheme(theme);
  log.measurements[`${theme}-themeId`] = await inTheia(`return themes.getCurrentTheme().id;`);
  const panelIcons = await panelPhase(theme);
  await tabsPhase(theme, panelIcons);
  await screenshot(cdp, path.join(evidenceDir, `${theme}-full-window.png`));
}

await inTheia(`for (const t of window.__brandTerms || []) t.dispose(); return true;`);
await writeFile(path.join(evidenceDir, 'run-l1-log.json'), JSON.stringify(log, null, 2));
const failed = log.checks.filter(c => !c.ok);
console.log(`CHECKS ${log.checks.length - failed.length}/${log.checks.length} PASS`);
cdp.close();
process.exit(failed.length ? 1 : 0);
