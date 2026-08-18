#!/usr/bin/env node
// 受け入れ条件「lint が error を出すケースで、警告表示 + 巻き戻しが機能する（不正な状態が
// 黙って残らない）」の実機確認。保存後 debounce lint が error を返す状況を外部書き込みで作り、
// 1) フッターに警告が出る 2)「直前の編集を元に戻す」ボタンが有効 3) 押すと edit.json が戻る
// の 3 点を実測する。
// 使い方: node check-lint-warning.mjs <cdpPort> <workspaceDir> <outJson>
import { setTimeout as sleep } from 'node:timers/promises';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { CDP, listTargets, evalOn, realClick } from '../../timeline-tracks/scripts/cdp-lib.mjs';

const [, , portArg, workspaceArg, outArg] = process.argv;
const PORT = Number(portArg);
const WS = workspaceArg;
const OUT = outArg;
const EDIT = path.join(WS, 'edit.json');
const log = [];
function record(step, data) { log.push({ step, ...data }); console.log(`[${step}]`, JSON.stringify(data)); }

const WIDGET = `(() => {
  const w = document.getElementById('akari-annotations-widget');
  if (!w) return null;
  const viewport = w.children[1];
  return { w, strip: viewport.children[1].children[0], footer: w.children[4] };
})()`;

async function footerState(cdp) {
  return evalOn(cdp, `(() => {
    const refs = ${WIDGET};
    if (!refs) return null;
    const button = refs.footer.querySelector('button');
    return {
      text: refs.footer.textContent,
      hasButton: Boolean(button),
      buttonLabel: button ? button.textContent : null,
      buttonDisabled: button ? button.disabled : null
    };
  })()`);
}

async function clipPoint(cdp) {
  return evalOn(cdp, `(() => {
    const el = document.querySelector('[data-akari-item-kind="cut"][data-akari-item-id="0"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, styleLeft: el.style.left };
  })()`);
}

async function clickUndoButton(cdp) {
  return evalOn(cdp, `(() => {
    const refs = ${WIDGET};
    const button = refs.footer.querySelector('button');
    if (!button) return false;
    button.click();
    return true;
  })()`);
}

async function readAt() {
  const value = JSON.parse(await readFile(EDIT, 'utf8'));
  return value.cuts?.[0]?.at ?? null;
}

async function drag(cdp, from, dx) {
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none' });
  await sleep(40);
  await cdp.send('Input.dispatchMouseEvent', {
    type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1
  });
  await sleep(40);
  for (let s = 1; s <= 12; s++) {
    await cdp.send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: from.x + dx * (s / 12), y: from.y, button: 'left', buttons: 1
    });
    await sleep(16);
  }
  await sleep(60);
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: from.x + dx, y: from.y, button: 'left' });
}

const targets = await listTargets(PORT);
const cdp = new CDP(targets.find(t => t.type === 'page').webSocketDebuggerUrl);
await cdp.connect();
await cdp.send('Runtime.enable');

// 0) ホーム画面の edit.json カードをダブルクリックしてタイムラインを開く（measure と同じ導線）
const cardExpression = [
  "(function(){",
  "  var nodes = Array.from(document.querySelectorAll('span'));",
  "  var hit = nodes.filter(function(e){",
  "    var own = Array.from(e.childNodes).filter(function(n){return n.nodeType===3})",
  "      .map(function(n){return n.textContent.trim()}).join('');",
  "    return own.indexOf('edit.json') >= 0;",
  "  })[0];",
  "  if (!hit) return null;",
  "  var r = hit.getBoundingClientRect();",
  "  return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };",
  "})()"
].join('\n');
let opened = await evalOn(cdp, `Boolean(${WIDGET})`);
for (let attempt = 0; attempt < 4 && !opened; attempt++) {
  const card = await evalOn(cdp, cardExpression);
  if (!card) { await sleep(1000); continue; }
  await realClick(cdp, card.x, card.y, { clickCount: 2 });
  for (let w = 0; w < 20 && !opened; w++) {
    await sleep(500);
    opened = await evalOn(cdp, `Boolean(${WIDGET})`);
  }
}
if (!opened) throw new Error('timeline widget did not open');
record('timeline-open', { opened });
await sleep(1500);

// 1) 外部書き込みで lint error を仕込む（存在しない素材への参照 = references.files が error）
const original = await readFile(EDIT, 'utf8');
const value = JSON.parse(original);
const atBeforeEdit = value.cuts[0].at ?? null;
const originalSourcePath = value.source.path;
value.source.path = 'media/missing-source.mov';
await writeFile(EDIT, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
record('injected-lint-error', {
  check: 'references.files（source.path が実ファイルへ解決しない = severity error）',
  originalSourcePath, atBeforeEdit
});
await sleep(3500);

// 2) 通常の編集（クリップ 1 個の移動）を行う
const before = await clipPoint(cdp);
record('clip-before', before);
await drag(cdp, before, 140);
await sleep(1200);
const atAfterMove = await readAt();
record('at-after-move', { atAfterMove });

// 3) 保存後 debounce lint の結果がフッターへ出るのを待つ
let footer = null;
const deadline = Date.now() + 25000;
while (Date.now() < deadline) {
  footer = await footerState(cdp);
  if (footer?.hasButton) break;
  await sleep(300);
}
record('footer-after-lint', footer ?? { footer: null });

// 4) 巻き戻し導線を押して edit.json が戻ることを確認
let clicked = false;
let atAfterUndo = atAfterMove;
if (footer?.hasButton && footer.buttonDisabled === false) {
  clicked = await clickUndoButton(cdp);
  await sleep(2500);
  atAfterUndo = await readAt();
}
record('after-undo', { clicked, atAfterUndo });

const result = {
  warningShown: Boolean(footer?.text?.includes('保存後の検証で問題が見つかりました')),
  undoAffordanceShown: footer?.buttonLabel === '直前の編集を元に戻す' && footer?.buttonDisabled === false,
  moveApplied: (atAfterMove ?? 0) !== (atBeforeEdit ?? 0),
  // at の不在と at: 0 は同じ位置。undo が明示 at: 0 を書くのは本タスク以前からの既存挙動。
  undoRestored: (atAfterUndo ?? 0) === (atBeforeEdit ?? 0),
  atBeforeEdit, atAfterMove, atAfterUndo, footer
};
result.verdict = result.warningShown && result.undoAffordanceShown && result.moveApplied && result.undoRestored
  ? 'PASS' : 'FAIL';
record('verdict', { verdict: result.verdict });
await writeFile(OUT, `${JSON.stringify({ result, log }, null, 2)}\n`);
cdp.close();
console.log(JSON.stringify(result, null, 1));
process.exitCode = result.verdict === 'PASS' ? 0 : 1;
