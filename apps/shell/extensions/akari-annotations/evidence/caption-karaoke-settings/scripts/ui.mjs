#!/usr/bin/env node
// 動きタブの「カラオケの設定」の実機確認（ラッパー作成の検証スクリプト。変更後のビルドで実行する）。
// 設定なしの表示（黄色・今の塗り方を正直に出す・固定の黄色の注記が無い）→ 歌い終わった色 / 塗りの進み方 / 開始位置を UI で書き、
// 書き込み先（captions.json の text_style.karaoke）・プレビューの 1 回再生（WAAPI の再生が走るか）・undo 1 回で戻るかを見る。
// 最後に「ポップ」の行でカラオケを新たに選び、試作の既定（#fb923c・char）が 1 回で入り undo 1 回で戻ることを見る。
// 使い方: node gen-fixture.mjs <作業用>/fixture plain && node ui.mjs <作業用ディレクトリ（実体パス）>
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { evalOn } from './cdp-lib.mjs';
import { command, sanitize, sleep, stop } from './l1-lib.mjs';
import { OUT, PORT, REPO, S, clickSel, dismissToasts, openProject, paths, selectCaption, shooter, start } from './common.mjs';
import { captionsOf } from './l1-common.mjs';
import { view } from './view.mjs';

const WORK = process.argv[2];
const MOTION = '[data-akari-ui="section:inspector-motion:caption"]';
const card = (kind, id) => `${MOTION} .akari-caption-motion-card[data-motion-kind="${kind}"][data-motion-id="${id}"]`;
const rec = { phase: 'ui', head: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), checks: [], shots: [] };
const check = (name, ok, detail) => { rec.checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
let session;
const p = paths(WORK, 'plain');
const capOf = async id => (await captionsOf(p.PJ)).find(c => c.id === id);
const SETTINGS = `(()=>{const m=document.querySelector(${S(MOTION)});if(!m)return null;const t=m.innerText;const i=t.indexOf('カラオケの設定');const btn=[...m.querySelectorAll('.akari-caption-motion-words button')];return{text:i<0?null:t.slice(i,i+400).replace(/\\s+/g,' '),fixedNote:t.includes('固定の黄色'),labels:['歌い終わった文字の色','まだの文字の色','塗りの進み方','開始位置'].filter(l=>t.includes(l)),pressed:btn.filter(b=>b.getAttribute('aria-pressed')==='true').map(b=>b.title||b.getAttribute('aria-label')||b.textContent.trim()),custom:m.querySelector('input[type=color][aria-label="任意の色"]')?.value??null,sampleColor:(()=>{const s=m.querySelector(${S(card('word-style', 'karaoke') + ' .akari-caption-motion-sample')});return s?s.style.getPropertyValue('--akari-motion-karaoke-color'):null})()}})()`;
const HOOK = `(()=>{window.__kReplay=[];if(!window.__kReplayTimer){window.__kReplayTimer=setInterval(()=>{const a=document.getAnimations().filter(x=>!(x instanceof CSSAnimation)&&x.playState==='running');if(a.length)window.__kReplay.push({t:Math.round(performance.now()),n:a.length,frames:a.slice(0,2).map(x=>{try{return JSON.stringify(x.effect.getKeyframes().map(k=>k.color||k.opacity||k.transform||'')).slice(0,120)}catch{return null}})})},50)}return true})()`;
try {
    session = await start(p); const cdp = session.cdp;
    const shot = shooter(p, 'ui');
    await openProject(session, p.PJ, 1);
    await dismissToasts(cdp);
    const v = await view(PORT);
    await selectCaption(cdp, 'c-0001');
    await clickSel(cdp, '[data-akari-ui="tab:inspector-motion"]'); await sleep(1500);
    await evalOn(cdp, `(()=>{document.querySelector(${S(MOTION)})?.querySelector('.akari-caption-motion-words')?.scrollIntoView({block:'center'});return true})()`); await sleep(800);
    const s0 = await evalOn(cdp, SETTINGS);
    rec.shots.push(await shot(cdp, '01-settings-none'));
    check('設定なし: 固定の黄色の注記が無く、4 項目が出る', s0 && !s0.fixedNote && s0.labels.length === 4, s0);
    check('設定なし: 実際の見た目（#ffd94a が選択・塗り方は未選択で今の塗り方の注記）', s0?.pressed.includes('#ffd94a') && !s0.pressed.some(x => /文字ずつ|語ずつ|なめらか/.test(x)) && /じわっと/.test(s0.text ?? ''), s0);
    const original = await capOf('c-0001');

    const act = async (label, selector, expect) => {
        await v.eval(HOOK);
        const before = await capOf('c-0001');
        await clickSel(cdp, selector); await sleep(2500);
        const after = await capOf('c-0001');
        const replay = await v.eval('window.__kReplay');
        const ok = expect(after.text_style?.karaoke ?? null, before);
        check(`${label}: 書き込み先 text_style.karaoke`, ok, { before: before.text_style ?? null, after: after.text_style ?? null });
        check(`${label}: プレビューで 1 回再生（WAAPI の再生を検出）`, replay.length > 0, { samples: replay.length, first: replay[0] ?? null, last: replay.at(-1) ?? null });
        await evalOn(cdp, command('akari.timeline.undo')); await sleep(2500);
        const undone = await capOf('c-0001');
        check(`${label}: undo 1 回で戻る`, isDeepStrictEqual(undone, before), { undone: undone.text_style ?? null });
        return after;
    };
    await act('歌い終わった色（見本 #60a5fa）', `${MOTION} button[title="#60a5fa"]`, k => k?.done_color === '#60a5fa' && k.fill === undefined && k.start_index === undefined);
    const fillSel = async title => evalOn(cdp, `(()=>{const b=[...document.querySelectorAll(${S(MOTION + ' .akari-caption-motion-words button')})].find(e=>e.textContent.trim()===${S(title)});if(!b)return null;b.setAttribute('data-k-test',${S(title)});return true})()`);
    for (const [fill, title] of [['smooth', 'なめらか'], ['word', '1 語ずつ'], ['char', '1 文字ずつ']]) {
        await fillSel(title);
        await act(`塗りの進み方（${title}）`, `${MOTION} button[data-k-test="${title}"]`, k => k?.fill === fill && k.done_color === undefined);
    }
    await evalOn(cdp, `(()=>{const b=document.querySelector(${S(MOTION + ' button[aria-label^="開始位置 4:"]')});if(b)b.setAttribute('data-k-test','start4');return !!b})()`);
    await act('開始位置（4 文字目 = index 3）', `${MOTION} button[data-k-test="start4"]`, k => k?.start_index === 3);
    check('一連の操作のあと元の行に戻っている', isDeepStrictEqual(await capOf('c-0001'), original), null);

    // 色を変えた状態の見た目（見本の色・選択表示）とプレビュー
    await clickSel(cdp, `${MOTION} button[title="#60a5fa"]`); await sleep(2000);
    await fillSel('なめらか'); await clickSel(cdp, `${MOTION} button[data-k-test="なめらか"]`); await sleep(2000);
    const s1 = await evalOn(cdp, SETTINGS);
    check('変更後: 選択表示と見本の色が選んだ値', s1?.pressed.includes('#60a5fa') && s1.pressed.includes('なめらか') && s1.sampleColor === '#60a5fa' && !/じわっと/.test(s1.text ?? ''), s1);
    await evalOn(cdp, command('akari.preview.seekOutput', { editUri: `file://${path.join(p.PJ, 'edit.json')}`, time: 1.15 })); await sleep(2500);
    rec.shots.push(await shot(cdp, '02-settings-blue-smooth'));
    rec.twoWrites = (await capOf('c-0001')).text_style;
    await evalOn(cdp, command('akari.timeline.undo')); await sleep(2000);
    await evalOn(cdp, command('akari.timeline.undo')); await sleep(2000);
    check('2 回の変更は undo 2 回で元に戻る', isDeepStrictEqual(await capOf('c-0001'), original), null);

    // 新たにカラオケを選ぶ（ポップの行）
    await selectCaption(cdp, 'c-0005');
    await clickSel(cdp, '[data-akari-ui="tab:inspector-motion"]'); await sleep(1500);
    const pop = await capOf('c-0005');
    await v.eval(HOOK);
    await clickSel(cdp, card('word-style', 'karaoke')); await sleep(2500);
    const k5 = await capOf('c-0005');
    const replay5 = await v.eval('window.__kReplay');
    check('新たにカラオケ: style=karaoke と試作の既定（#fb923c・char）が 1 回で入る', k5.style === 'karaoke' && k5.text_style?.karaoke?.done_color === '#fb923c' && k5.text_style?.karaoke?.fill === 'char', { style: k5.style, text_style: k5.text_style });
    check('新たにカラオケ: プレビューで 1 回再生', replay5.length > 0, { samples: replay5.length, first: replay5[0] ?? null });
    await evalOn(cdp, `(()=>{document.querySelector(${S(MOTION)})?.querySelector('.akari-caption-motion-words')?.scrollIntoView({block:'center'});return true})()`); await sleep(800);
    const s5 = await evalOn(cdp, SETTINGS);
    check('新たにカラオケ: 設定欄が #fb923c・1 文字ずつを選択表示', s5?.pressed.includes('#fb923c') && s5.pressed.includes('1 文字ずつ'), s5);
    rec.shots.push(await shot(cdp, '03-new-karaoke-defaults'));
    await evalOn(cdp, command('akari.timeline.undo')); await sleep(2500);
    check('新たにカラオケ: undo 1 回でポップに戻る', isDeepStrictEqual(await capOf('c-0005'), pop), { now: await capOf('c-0005') });
    v.close();
    rec.status = 'recorded';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
    try { execFileSync('/usr/bin/pkill', ['-f', p.ISO]); } catch {}
    await writeFile(path.join(OUT, 'results-ui.json'), `${S(rec, null, 2).replaceAll(WORK, '<work>').replaceAll(REPO, '<worktree>')}\n`);
}
console.log(S({ status: rec.status, error: rec.error, pass: rec.checks.filter(c => c.ok).length, fail: rec.checks.filter(c => !c.ok).map(c => c.name) }));
