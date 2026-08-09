// L1 実測: 2026-08-09-catalog-audition-stop
// 常設再生バー + 面外クリック/離脱での自動停止を実機 CDP で検証する。
import { setTimeout as sleep } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { connectMain, evalMain, realClick, screenshot } from './cdp-lib.mjs';
import {
  installErrorCounter, errorCount, errorLog,
  ensureRoleBucketsWidgetVisible, clickCatalogTab, clickMaterialsTab,
  catalogItemStates, clickCategoryChip, waitFor
} from './widget-lib.mjs';

const [, , cdpPortArg, evidenceDirArg] = process.argv;
const CDP_PORT = Number(cdpPortArg);
const EVIDENCE_DIR = evidenceDirArg;

const log = [];
function record(step, data) { const e = { t: new Date().toISOString(), step, ...data }; log.push(e); console.log(`[${step}]`, JSON.stringify(data)); }
function fail(message, data) { record('FAIL:' + message, data || {}); throw new Error(message); }

// 24x24 円形ボタン（音源試聴トグル）は CDP 合成マウス座標クリックが効かない既知の癖
// （catalog-account-first-ux/README.md）。native click() で発火させる。
async function clickAudioToggleForKey(cdp, key) {
  await evalMain(cdp, `document.querySelector('[data-akari-catalog-item="${key}"] [data-akari-catalog-audio-toggle]').click()`);
}

async function firstAudioItemKey(cdp) {
  return evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-catalog-audio-toggle]');
    if (!el) return null;
    const card = el.closest('[data-akari-catalog-item]');
    return card ? card.getAttribute('data-akari-catalog-item') : null;
  })()`);
}

async function audioBarState(cdp) {
  return evalMain(cdp, `(() => {
    const bar = document.querySelector('[data-akari-catalog-audio-bar]');
    if (!bar) return { present: false };
    return { present: true, text: bar.textContent };
  })()`);
}

async function clickAudioBarStop(cdp) {
  const state = await evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-catalog-audio-bar-stop]');
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (!state.found) throw new Error('audio bar stop button not found');
  await realClick(cdp, state.x, state.y);
}

// widget 内部の catalogAudioElement（プレーンな new Audio() — DOM 未接続なので
// document.querySelector('audio') では見えない）へ、ApplicationShell 経由で直接届く。
// task.md 受入5「<audio> の paused=true を実測」に応えるための唯一の経路。
async function readCatalogAudioState(cdp) {
  return evalMain(cdp, `(() => {
    const bd = window.theia.container._bindingDictionary;
    const keys = [...bd._map.keys()];
    // production ビルドはクラス名を minify するため k.name では引けない
    // （実測: 'ApplicationShell' ではなく 'BO' 等の短縮名になっていた）。
    // getWidgetById はプロパティ名なので minify されない — これで ApplicationShell
    // のコンストラクタ関数を一意に特定する。
    const shellKey = keys.find(k => typeof k === 'function' && k.prototype && typeof k.prototype.getWidgetById === 'function');
    if (!shellKey) return { ok: false, reason: 'ApplicationShell key not found' };
    const shell = window.theia.container.get(shellKey);
    const widget = shell.getWidgetById('akari-role-buckets-widget');
    if (!widget) return { ok: false, reason: 'widget not found by id' };
    const el = widget.catalogAudioElement;
    return {
      ok: true,
      paused: el.paused,
      hasSrc: !!el.src,
      playingCatalogAudioKey: widget.playingCatalogAudioKey ?? null,
      playingCatalogAudioTitle: widget.playingCatalogAudioTitle ?? null
    };
  })()`);
}

async function setCatalogSearchWithoutClick(cdp, text) {
  // 「検索語を入れてもバーは残る」（受入2）ことをクリックに依らず検証するため、
  // フォーカス→React 制御 input へ値を反映する native setter + input イベントで打つ
  // （実クリックを介さない — 面外クリック検知の対象にしない設計上の判断。report.md 参照）。
  const ok = await evalMain(cdp, `(() => {
    const el = document.querySelector('input[aria-label="カタログを検索"]');
    if (!el) return false;
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(text)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  if (!ok) throw new Error('catalog search input not found (no-click path)');
  await sleep(300);
}

async function main() {
  const cdp = await connectMain(CDP_PORT);
  await installErrorCounter(cdp);
  await ensureRoleBucketsWidgetVisible(cdp);
  await clickCatalogTab(cdp);

  // audio カード（resolver origin のみ mediaUrl を持つ）が現れるまで待つ。
  const items = await waitFor(
    () => catalogItemStates(cdp),
    states => states.length > 0,
    30000
  );
  record('setup:item-count', { count: items.length });
  if (!items.length) fail('no catalog items appeared (resolver reachability required for this L1 run)', {});

  await clickCategoryChip(cdp, 'audio');
  await sleep(400);
  const audioKey = await firstAudioItemKey(cdp);
  record('setup:audio-key', { audioKey });
  if (!audioKey) fail('no audio preview toggle found under audio category', {});

  const titleBefore = await evalMain(cdp, `document.querySelector('[data-akari-catalog-item="${audioKey}"]').getAttribute('title')`);
  record('setup:title', { titleBefore });

  // --- L1-1: 再生 → 常設バー出現（タイトル一致）→ バーの停止ボタン → 停止・バー消滅 ---
  await clickAudioToggleForKey(cdp, audioKey);
  await sleep(1200);
  const playing1 = await evalMain(cdp, `document.querySelector('[data-akari-catalog-item="${audioKey}"] [data-akari-catalog-audio-playing="true"]') ? true : false`);
  record('L1-1:playing-flag', { playing1 });
  if (!playing1) fail('audio did not report playing state after toggle', {});
  const bar1 = await audioBarState(cdp);
  record('L1-1:bar-appeared', bar1);
  if (!bar1.present || !bar1.text.includes(titleBefore) || !bar1.text.includes('再生中')) fail('audio bar did not appear with matching title', { bar1, titleBefore });
  const audioState1 = await readCatalogAudioState(cdp);
  record('L1-1:audio-element-state-while-playing', audioState1);
  if (!audioState1.ok || audioState1.paused !== false) fail('underlying <audio> element is not actually playing', audioState1);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '01-audio-bar-playing.png'));

  await clickAudioBarStop(cdp);
  await sleep(500);
  const bar1After = await audioBarState(cdp);
  record('L1-1:bar-after-stop', bar1After);
  if (bar1After.present) fail('audio bar did not disappear after clicking its stop button', bar1After);
  const audioState1After = await readCatalogAudioState(cdp);
  record('L1-1:audio-element-state-after-bar-stop', audioState1After);
  if (!audioState1After.ok || audioState1After.paused !== true) fail('underlying <audio> element did not pause after bar stop', audioState1After);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '02-after-bar-stop.png'));

  // --- L1-2: 再生中に検索語で再生中カードをフィルタアウト → バーは残る → 停止できる ---
  await clickAudioToggleForKey(cdp, audioKey);
  await sleep(1200);
  const playing2 = await evalMain(cdp, `document.querySelector('[data-akari-catalog-item="${audioKey}"] [data-akari-catalog-audio-playing="true"]') ? true : false`);
  if (!playing2) fail('audio did not start playing for L1-2 setup', {});

  const beforeSearchVisible = await evalMain(cdp, `!!document.querySelector('[data-akari-catalog-item="${audioKey}"]')`);
  await setCatalogSearchWithoutClick(cdp, '__no-such-catalog-item-zzz__');
  const afterSearchVisible = await evalMain(cdp, `!!document.querySelector('[data-akari-catalog-item="${audioKey}"]')`);
  record('L1-2:filtered-out', { beforeSearchVisible, afterSearchVisible });
  if (!beforeSearchVisible || afterSearchVisible) fail('search did not filter the playing card out of the visible list', { beforeSearchVisible, afterSearchVisible });

  const bar2 = await audioBarState(cdp);
  record('L1-2:bar-remains-after-filter', bar2);
  if (!bar2.present) fail('audio bar disappeared even though the search input click-exemption should keep playback alive', bar2);
  const audioState2 = await readCatalogAudioState(cdp);
  record('L1-2:audio-still-playing-after-filter', audioState2);
  if (!audioState2.ok || audioState2.paused !== false) fail('playback stopped merely from typing a search query', audioState2);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '03-bar-remains-after-search-filter.png'));

  await clickAudioBarStop(cdp);
  await sleep(500);
  const audioState2After = await readCatalogAudioState(cdp);
  record('L1-2:stopped-via-bar-after-filter', audioState2After);
  if (!audioState2After.ok || audioState2After.paused !== true) fail('could not stop via the bar after the card was filtered out', audioState2After);

  // 検索欄を空に戻す（次シナリオのため）。
  await setCatalogSearchWithoutClick(cdp, '');
  await sleep(400);

  // --- L1-3: 再生中にカテゴリチップを All→still に切替 → バーで停止できる（または切替自体で停止） ---
  await clickCategoryChip(cdp, 'audio');
  await sleep(400);
  await clickAudioToggleForKey(cdp, audioKey);
  await sleep(1200);
  const playing3 = await evalMain(cdp, `document.querySelector('[data-akari-catalog-item="${audioKey}"] [data-akari-catalog-audio-playing="true"]') ? true : false`);
  if (!playing3) fail('audio did not start playing for L1-3 setup', {});
  await clickCategoryChip(cdp, 'still');
  await sleep(500);
  const audioState3 = await readCatalogAudioState(cdp);
  record('L1-3:state-after-category-switch', audioState3);
  // 本実装の選択: カテゴリチップの実クリックは面外クリック検知（renderCatalogTab の
  // onClick）にバブリングし、切替自体が停止させる（report.md に明記する選択）。
  // 万一まだ再生中なら常設バーからも止められることを確認する（どちらの実装でも合格）。
  if (audioState3.ok && audioState3.paused === false) {
    const bar3 = await audioBarState(cdp);
    if (!bar3.present) fail('audio still playing after category switch but bar is not available to stop it', { audioState3, bar3 });
    await clickAudioBarStop(cdp);
    await sleep(500);
    const audioState3After = await readCatalogAudioState(cdp);
    record('L1-3:stopped-via-bar-after-category-switch', audioState3After);
    if (!audioState3After.ok || audioState3After.paused !== true) fail('could not stop via bar after category switch', audioState3After);
  }
  await screenshot(cdp, path.join(EVIDENCE_DIR, '04-category-switch-outcome.png'));

  await clickCategoryChip(cdp, 'All');
  await sleep(300);
  await clickCategoryChip(cdp, 'audio');
  await sleep(300);

  // --- L1-4: 再生中に「面内の他の場所」（再生ボタン・バー以外）をクリック → 停止する ---
  await clickAudioToggleForKey(cdp, audioKey);
  await sleep(1200);
  const playing4 = await evalMain(cdp, `document.querySelector('[data-akari-catalog-item="${audioKey}"] [data-akari-catalog-audio-playing="true"]') ? true : false`);
  if (!playing4) fail('audio did not start playing for L1-4 setup', {});
  // アカウント見出し（再生ボタンでもバーでもない、明確な「面内の他の場所」）をクリックする。
  const headerPoint = await evalMain(cdp, `(() => {
    const el = document.querySelector('[data-akari-catalog-account-header]');
    const r = el.getBoundingClientRect();
    return { x: r.left + 10, y: r.top + 10 };
  })()`);
  await realClick(cdp, headerPoint.x, headerPoint.y);
  await sleep(500);
  const audioState4 = await readCatalogAudioState(cdp);
  record('L1-4:stopped-by-outside-click', audioState4);
  if (!audioState4.ok || audioState4.paused !== true) fail('clicking elsewhere in the catalog pane did not stop playback', audioState4);
  const bar4 = await audioBarState(cdp);
  if (bar4.present) fail('audio bar should disappear once playback is stopped by an outside click', bar4);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '05-stopped-by-outside-click.png'));

  // --- L1-5: 再生中に「← 素材にもどる」で離脱 → 停止（<audio> paused=true を実測） ---
  await clickAudioToggleForKey(cdp, audioKey);
  await sleep(1200);
  const playing5 = await evalMain(cdp, `document.querySelector('[data-akari-catalog-item="${audioKey}"] [data-akari-catalog-audio-playing="true"]') ? true : false`);
  if (!playing5) fail('audio did not start playing for L1-5 setup', {});
  const audioState5Before = await readCatalogAudioState(cdp);
  record('L1-5:before-leaving', audioState5Before);
  if (!audioState5Before.ok || audioState5Before.paused !== false) fail('setup for L1-5 did not actually start playback', audioState5Before);
  await clickMaterialsTab(cdp);
  await sleep(500);
  const audioState5After = await readCatalogAudioState(cdp);
  record('L1-5:after-leaving-to-materials', audioState5After);
  if (!audioState5After.ok || audioState5After.paused !== true) fail('leaving the catalog pane via back-to-materials did not pause the underlying <audio> element', audioState5After);
  await screenshot(cdp, path.join(EVIDENCE_DIR, '06-materials-after-leaving.png'));

  // --- 回帰: 再生/停止/カード切替（別カード再生で前の再生が止まり切り替わる） ---
  await clickCatalogTab(cdp);
  await sleep(400);
  await clickCategoryChip(cdp, 'audio');
  await sleep(400);
  const audioKeys = await evalMain(cdp, `Array.from(document.querySelectorAll('[data-akari-catalog-audio-toggle]')).map(el => el.closest('[data-akari-catalog-item]').getAttribute('data-akari-catalog-item'))`);
  record('regression:audio-keys', { count: audioKeys.length, first3: audioKeys.slice(0, 3) });
  if (audioKeys.length < 2) fail('need at least 2 audio items for card-switch regression', { audioKeys });
  const [keyA, keyB] = audioKeys;
  await clickAudioToggleForKey(cdp, keyA);
  await sleep(1000);
  await clickAudioToggleForKey(cdp, keyB);
  await sleep(1000);
  const switchState = await evalMain(cdp, `({
    aPlaying: document.querySelector('[data-akari-catalog-item="${keyA}"] [data-akari-catalog-audio-playing="true"]') ? true : false,
    bPlaying: document.querySelector('[data-akari-catalog-item="${keyB}"] [data-akari-catalog-audio-playing="true"]') ? true : false
  })`);
  record('regression:card-switch', switchState);
  if (switchState.aPlaying || !switchState.bPlaying) fail('switching to a different card did not move the playing flag as before', switchState);
  // 同じカード再クリックでの停止（既存挙動）。
  await clickAudioToggleForKey(cdp, keyB);
  await sleep(500);
  const bPlayingAfterReclick = await evalMain(cdp, `document.querySelector('[data-akari-catalog-item="${keyB}"] [data-akari-catalog-audio-playing="true"]') ? true : false`);
  record('regression:same-card-reclick-stops', { bPlayingAfterReclick });
  if (bPlayingAfterReclick) fail('re-clicking the same playing card no longer stops it', {});

  // --- 回帰: origin='local' の「取り込む」「頼む」（存在確認 + クリック後 console.error 増分 0） ---
  await clickCategoryChip(cdp, 'All');
  await sleep(400);
  const localVerbs = await evalMain(cdp, `(() => {
    const importBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '取り込む');
    const askBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === '頼む');
    return {
      importPresent: !!importBtn,
      askPresent: !!askBtn,
      importPoint: importBtn ? (() => { const r = importBtn.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })() : null
    };
  })()`);
  record('regression:local-verbs-present', { importPresent: localVerbs.importPresent, askPresent: localVerbs.askPresent });
  if (!localVerbs.importPresent || !localVerbs.askPresent) fail('local catalog verb buttons (取り込む/頼む) missing', localVerbs);
  const errBeforeVerb = await errorCount(cdp);
  if (localVerbs.importPoint) {
    await realClick(cdp, localVerbs.importPoint.x, localVerbs.importPoint.y);
    await sleep(500);
  }
  const errAfterVerb = await errorCount(cdp);
  record('regression:local-verb-click-error-delta', { errBeforeVerb, errAfterVerb });
  if (errAfterVerb > errBeforeVerb) fail('clicking 取り込む increased console.error count', { errBeforeVerb, errAfterVerb, log: (await errorLog(cdp)).slice(-5) });

  // --- 回帰: カタログ検索（既存機能そのもの） ---
  const beforeSearchCount = (await catalogItemStates(cdp)).length;
  await setCatalogSearchWithoutClick(cdp, 'zzz-nonexistent-term-zzz');
  const afterSearchCount = (await catalogItemStates(cdp)).length;
  record('regression:catalog-search', { beforeSearchCount, afterSearchCount });
  if (afterSearchCount >= beforeSearchCount) fail('catalog search regression: term did not narrow the list', { beforeSearchCount, afterSearchCount });
  await setCatalogSearchWithoutClick(cdp, '');
  await sleep(300);

  // --- 回帰: still カード無影響（音源トグルが出ない・クリックでエラーなし） ---
  await clickCategoryChip(cdp, 'still');
  await sleep(400);
  const stillCheck = await evalMain(cdp, `(() => {
    const cards = Array.from(document.querySelectorAll('[data-akari-catalog-item]'));
    const toggles = document.querySelectorAll('[data-akari-catalog-audio-toggle]');
    return { stillCardCount: cards.length, audioToggleCountInStill: toggles.length };
  })()`);
  record('regression:still-cards', stillCheck);
  if (stillCheck.stillCardCount === 0) fail('no still cards found for regression check', stillCheck);
  if (stillCheck.audioToggleCountInStill !== 0) fail('audio toggle unexpectedly present on still cards', stillCheck);

  const finalErrCount = await errorCount(cdp);
  const finalErrLog = await errorLog(cdp);
  record('console-error-summary', { count: finalErrCount, sample: finalErrLog.slice(0, 10) });
  if (finalErrCount > 0) fail('non-zero console.error/unhandledrejection across the whole run', { count: finalErrCount, sample: finalErrLog.slice(0, 10) });

  await writeFile(path.join(EVIDENCE_DIR, 'audition-stop-log.json'), JSON.stringify(log, null, 2));
  console.log('AUDITION_STOP_OK');
  cdp.close();
}

main().then(() => process.exit(0)).catch(error => {
  console.error('AUDITION_STOP_FAILED', error);
  process.exit(1);
});
