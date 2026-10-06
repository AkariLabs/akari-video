#!/usr/bin/env node
// 動きパネルの「押し直しで外す」「なし」の実機確認（ラッパー作成の検証スクリプト。変更後のビルドで実行する）。
// nobag: captions.json の text_style.animation が外れる・他の text_style は不変・Cmd+Z で戻る・外したとき実演が走らない・スキーマ検証。
// bag  : 袋の字幕の「動き」カード / 組を押し直すと edit.json の袋 item の motion が外れる・Cmd+Z で戻る。
// 使い方: node gen-fixture.mjs <作業用>/fixture && node l1.mjs <作業用ディレクトリ（実体パス）> nobag|bag
import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { evalOn } from './cdp-lib.mjs';
import { sanitize, stop } from './l1-lib.mjs';
import { schemaCheck } from './schema-check.mjs';
import { OUT, REPO, S, captionsOf, clickSel, dismissToasts, key, openTimeline, paths, readJson, selectCaption, shooter, sleep, start, waitEval } from './common.mjs';

const WORK = process.argv[2];
const NAME = process.argv[3] || 'nobag';
const MOTION = '[data-akari-ui="section:inspector-motion:caption"]';
const card = (kind, id) => `${MOTION} .akari-caption-motion-card[data-motion-kind="${kind}"][data-motion-id="${id}"]`;
const rec = { phase: NAME, head: execFileSync('/usr/bin/git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO, encoding: 'utf8' }).trim(), checks: [], shots: [], steps: {} };
const check = (name, ok, detail) => { rec.checks.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`); };
const p = paths(WORK, NAME);
let session;

const capOf = async id => (await captionsOf(p.PJ)).find(c => c.id === id);
const bagOf = async () => (await readJson(path.join(p.PJ, 'edit.json'))).tracks.find(t => t.id === 'v-captions').items[0];
async function until(label, read, ok, timeoutMs = 10_000) {
    const deadline = Date.now() + timeoutMs; let last;
    while (Date.now() < deadline) { last = await read(); if (ok(last)) return { ok: true, value: last }; await sleep(150); }
    return { ok: false, value: last, label };
}
// validate-captions CLI と、captions.schema.json の Ajv 検証（minProperties を含む）の両方
const validateCaptions = (file = path.join(p.PJ, 'captions.json')) => {
    const r = spawnSync(process.execPath, [path.join(REPO, 'packages/schemas/bin/validate-captions.mjs'), file], { encoding: 'utf8' });
    const ajv = schemaCheck(file);
    return { status: r.status === 0 && ajv.ok ? 0 : 1, cli: r.status, ajv };
};
const pressed = sel => `(()=>{const e=document.querySelector(${S(sel)});return e?e.getAttribute('aria-pressed'):null})()`;
const PLAYS_HOOK = `(()=>{window.__l1Plays=[];if(!window.__l1PlayHooked){window.__l1PlayHooked=true;window.addEventListener('akari-caption-motion-play',e=>window.__l1Plays.push(e.detail))}return true})()`;
const switchButton = label => `(()=>{const b=[...document.querySelectorAll(${S(MOTION + ' .akari-caption-motion-switch button')})].find(e=>e.textContent.trim()===${S(label)});if(!b)return null;b.setAttribute('data-l1-switch',${S(label)});return true})()`;
// 書き込み直後のパネル再描画と重なると押した切替が消えるので、再描画を待ってから押し、切替が効いたかを見て 1 回だけ押し直す
async function clickSwitch(cdp, label) {
    await sleep(1500);
    for (let attempt = 0; attempt < 2; attempt++) {
        await waitEval(cdp, switchButton(label), { label: `switch ${label}`, timeoutMs: 15_000 });
        await clickSel(cdp, `${MOTION} .akari-caption-motion-switch button[data-l1-switch="${label}"]`);
        await sleep(1200);
        if (label === 'なし') return;
        const on = await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll(${S(MOTION + ' .akari-caption-motion-switch button')})].find(e=>e.textContent.trim()===${S(label)});return b?.getAttribute('aria-pressed')==='true'})()`);
        if (on) return;
    }
    throw new Error(`switch ${label} did not take`);
}
async function openMotion(cdp, id) {
    await selectCaption(cdp, id);
    await clickSel(cdp, '[data-akari-ui="tab:inspector-motion"]'); await sleep(1500);
    await waitEval(cdp, `!!document.querySelector(${S(MOTION + ' .akari-caption-motion-card')})`, { label: 'motion panel', timeoutMs: 20_000 });
}
// 押してすぐの押された表示（書き込みの往復を待たずに読む）と、実演イベントの数
async function clickAndPeek(cdp, sel) {
    await evalOn(cdp, PLAYS_HOOK);
    await clickSel(cdp, sel);
    const now = await evalOn(cdp, pressed(sel));
    return now;
}
// Cmd+Z（Meta+Z）。効かなければタイムラインのチップを押してフォーカスを移してからもう一度（どちらで戻ったかを記録）
async function cmdZ(cdp, chipId, read, ok) {
    await key(cdp, 'z', 'KeyZ', 90, 4);
    let r = await until('undo', read, ok, 5000);
    if (r.ok) return { via: 'Cmd+Z', ...r };
    await clickSel(cdp, `.akari-annotations-strip-caption[data-akari-item-id="${chipId}"]`); await sleep(800);
    await key(cdp, 'z', 'KeyZ', 90, 4);
    r = await until('undo', read, ok, 5000);
    return { via: 'Cmd+Z (after focusing timeline chip)', ...r };
}

try {
    session = await start(p); const cdp = session.cdp;
    const shot = shooter(p, NAME);
    await openTimeline(session);
    await dismissToasts(cdp);

    if (NAME === 'nobag') {
        // 1. 登場「フェード」を当てる → 動きカードとテキストアニメの両方が押された表示
        await openMotion(cdp, 'c-0001');
        const original = await capOf('c-0001');
        await clickSel(cdp, card('slot', 'fade'));
        const applied = await until('fade applied', () => capOf('c-0001'), c => c.text_style?.animation?.in?.id === 'fade-in-out');
        check('1. 登場「フェード」が captions.json に入る', applied.ok, applied.value?.text_style);
        await waitEval(cdp, `${pressed(card('slot', 'fade'))}==='true'`, { label: 'fade pressed', timeoutMs: 10_000 }).catch(() => null);
        const both = { slot: await evalOn(cdp, pressed(card('slot', 'fade'))), textanim: await evalOn(cdp, pressed(card('textanim', 'fade-in-out'))) };
        check('1. 「動き」のフェードとテキストアニメのフェードの両方が押された表示', both.slot === 'true' && both.textanim === 'true', both);
        rec.shots.push(await shot(cdp, '01-fade-applied'));

        // 2. もう一度「フェード」→ animation が消える・他の text_style は不変・実演が走らない
        const peek = await clickAndPeek(cdp, card('slot', 'fade'));
        const cleared = await until('fade cleared', () => capOf('c-0001'), c => c.text_style?.animation === undefined);
        await sleep(1200);
        const plays = await evalOn(cdp, 'window.__l1Plays');
        check('2. 押し直し: 押された表示が即座に外れる', peek === 'false', { pressedRightAfterClick: peek });
        check('2. 押し直し: text_style.animation が消える', cleared.ok, cleared.value?.text_style);
        check('2. 押し直し: 他の text_style は不変', isDeepStrictEqual(cleared.value?.text_style, original.text_style), { before: original.text_style, after: cleared.value?.text_style });
        check('2. 押し直し: 6 秒の実演イベントが出ない', Array.isArray(plays) && plays.length === 0, plays);
        const v2 = validateCaptions();
        check('2. 外した後の captions.json がスキーマ検証を通る', v2.status === 0, v2);
        rec.shots.push(await shot(cdp, '02-fade-cleared'));

        // 3. Cmd+Z 1 手で戻る
        const undo3 = await cmdZ(cdp, 'c-0001', () => capOf('c-0001'), c => c.text_style?.animation?.in?.id === 'fade-in-out');
        check('3. Cmd+Z 1 手でフェードが戻る', undo3.ok, { via: undo3.via, text_style: undo3.value?.text_style });
        rec.steps.undo3 = undo3.via;

        // 4. テキストアニメ側の「フェード」からも外せる
        await openMotion(cdp, 'c-0001');
        await waitEval(cdp, `${pressed(card('textanim', 'fade-in-out'))}==='true'`, { label: 'textanim fade pressed', timeoutMs: 10_000 }).catch(() => null);
        const peek4 = await clickAndPeek(cdp, card('textanim', 'fade-in-out'));
        const cleared4 = await until('textanim cleared', () => capOf('c-0001'), c => c.text_style?.animation === undefined);
        check('4. テキストアニメ「フェード」の押し直しでも外れる', cleared4.ok && peek4 === 'false', { pressedRightAfterClick: peek4, text_style: cleared4.value?.text_style });

        // 5. 組「タイプライター」→ 押し直しで in / out の両方が消える → Cmd+Z で戻る
        await openMotion(cdp, 'c-0003');
        const original3 = await capOf('c-0003');
        await clickSel(cdp, card('combo', 'typewriter'));
        const tw = await until('typewriter', () => capOf('c-0003'), c => c.text_style?.animation?.in?.id === 'typewriter' && c.text_style?.animation?.out?.id === 'fade-in-out');
        check('5. 組「タイプライター」で in=typewriter / out=fade-in-out', tw.ok, tw.value?.text_style);
        await waitEval(cdp, `${pressed(card('combo', 'typewriter'))}==='true'`, { label: 'combo pressed', timeoutMs: 10_000 }).catch(() => null);
        rec.shots.push(await shot(cdp, '05-typewriter-applied'));
        const peek5 = await clickAndPeek(cdp, card('combo', 'typewriter'));
        const cleared5 = await until('typewriter cleared', () => capOf('c-0003'), c => c.text_style?.animation === undefined);
        await sleep(1200);
        const plays5 = await evalOn(cdp, 'window.__l1Plays');
        check('5. 組の押し直しで in / out の両方が消える（他の text_style は不変）', cleared5.ok && isDeepStrictEqual(cleared5.value?.text_style, original3.text_style), cleared5.value?.text_style);
        check('5. 組の押し直し: 押された表示が即座に外れ、実演が走らない', peek5 === 'false' && plays5.length === 0, { pressedRightAfterClick: peek5, plays: plays5 });
        const undo5 = await cmdZ(cdp, 'c-0003', () => capOf('c-0003'), c => c.text_style?.animation?.in?.id === 'typewriter' && c.text_style?.animation?.out?.id === 'fade-in-out');
        check('5. Cmd+Z 1 手で組が戻る', undo5.ok, { via: undo5.via, text_style: undo5.value?.text_style });

        // 6. 「なし」（登場を選択中）→ in だけ消え out は残る
        await openMotion(cdp, 'c-0003');
        const none6 = await evalOn(cdp, `(()=>{const b=[...document.querySelectorAll(${S(MOTION + ' .akari-caption-motion-switch button')})];return b.map(e=>({text:e.textContent.trim(),pressed:e.getAttribute('aria-pressed')}))})()`);
        rec.steps.switchButtons = none6;
        rec.shots.push(await shot(cdp, '06-none-button'));
        await evalOn(cdp, PLAYS_HOOK);
        await clickSwitch(cdp, 'なし');
        const in6 = await until('in cleared', () => capOf('c-0003'), c => c.text_style?.animation?.in === undefined);
        check('6. 「なし」（登場）で in だけ消え out は残る', in6.ok && in6.value?.text_style?.animation?.out?.id === 'fade-in-out', in6.value?.text_style);
        const v6 = validateCaptions();
        check('6. 「なし」の後の captions.json がスキーマ検証を通る', v6.status === 0, v6);
        const undo6 = await cmdZ(cdp, 'c-0003', () => capOf('c-0003'), c => c.text_style?.animation?.in?.id === 'typewriter');
        check('6. Cmd+Z 1 手で in が戻る', undo6.ok, { via: undo6.via, text_style: undo6.value?.text_style });

        // 7. 強調（loop）を当てて押し直す → loop だけ消え、animation が空ならキーごと消える・スキーマ検証
        await openMotion(cdp, 'c-0002');
        await clickSwitch(cdp, '強調');
        await clickSel(cdp, card('slot', 'pulse'));
        const loop7 = await until('loop applied', () => capOf('c-0002'), c => c.text_style?.animation?.loop?.id === 'heartbeat');
        check('7. 強調「パルス」で loop=heartbeat', loop7.ok, loop7.value?.text_style);
        await waitEval(cdp, `${pressed(card('slot', 'pulse'))}==='true'`, { label: 'pulse pressed', timeoutMs: 10_000 }).catch(() => null);
        const peek7 = await clickAndPeek(cdp, card('slot', 'pulse'));
        const cleared7 = await until('loop cleared', () => capOf('c-0002'), c => c.text_style?.animation === undefined);
        check('7. 強調の押し直しで loop が消え、空の animation はキーごと消える', cleared7.ok && peek7 === 'false', { pressedRightAfterClick: peek7, text_style: cleared7.value?.text_style });
        const v7 = validateCaptions();
        check('7. loop を外した後の captions.json がスキーマ検証を通る', v7.status === 0, v7);
        // 対照: 空の animation {} はスキーマが弾く（検証器が minProperties を見ていることの確認）
        const neg = await readJson(path.join(p.PJ, 'captions.json'));
        neg.captions.find(c => c.id === 'c-0002').text_style.animation = {};
        const negDir = await mkdtemp(path.join(tmpdir(), 'tl-caption-motion-clear-neg-'));
        await writeFile(path.join(negDir, 'captions.json'), `${JSON.stringify(neg, null, 2)}\n`);
        const negRun = validateCaptions(path.join(negDir, 'captions.json'));
        check('7. 対照: animation が {} の captions.json はスキーマ検証（Ajv）で落ちる', !negRun.ajv.ok, negRun);
        // loop と in が両方あるときは loop だけ消える
        await clickSel(cdp, card('slot', 'pulse'));
        await until('loop again', () => capOf('c-0002'), c => c.text_style?.animation?.loop?.id === 'heartbeat');
        await clickSwitch(cdp, '登場');
        await clickSel(cdp, card('slot', 'pop'));
        const both7 = await until('in+loop', () => capOf('c-0002'), c => c.text_style?.animation?.in?.id === 'pop' && c.text_style?.animation?.loop?.id === 'heartbeat');
        await clickSwitch(cdp, '強調');
        await waitEval(cdp, `${pressed(card('slot', 'pulse'))}==='true'`, { label: 'pulse pressed', timeoutMs: 10_000 }).catch(() => null);
        await clickSel(cdp, card('slot', 'pulse'));
        const only7 = await until('loop only cleared', () => capOf('c-0002'), c => c.text_style?.animation?.loop === undefined);
        check('7. in と loop があるとき強調の押し直しで loop だけ消える', both7.ok && only7.ok && only7.value?.text_style?.animation?.in?.id === 'pop', only7.value?.text_style);

        // 8. 退場の「なし」
        await openMotion(cdp, 'c-0004');
        await clickSwitch(cdp, '退場');
        await clickSel(cdp, card('slot', 'fade'));
        const out8 = await until('out applied', () => capOf('c-0004'), c => c.text_style?.animation?.out?.id === 'fade-in-out');
        await clickSwitch(cdp, 'なし');
        const cleared8 = await until('out cleared', () => capOf('c-0004'), c => c.text_style?.animation === undefined);
        check('8. 退場「フェード」→「なし」（退場を選択中）で out が消える', out8.ok && cleared8.ok, cleared8.value?.text_style);
        const v8 = validateCaptions();
        check('8. 最終の captions.json がスキーマ検証を通る', v8.status === 0, v8);
    } else {
        // 9. 袋の字幕: 「動き」カードの押し直しで edit.json の袋 item の motion.in が消える → Cmd+Z で戻る
        await openMotion(cdp, 'c-0001');
        const bag0 = await bagOf();
        const caps0 = await captionsOf(p.PJ);
        await clickSel(cdp, card('slot', 'fade'));
        const in9 = await until('bag in', bagOf, b => b.motion?.in?.preset === 'fade');
        check('9. 袋: 登場「フェード」が edit.json の袋 item の motion.in に入る', in9.ok, in9.value?.motion);
        await waitEval(cdp, `${pressed(card('slot', 'fade'))}==='true'`, { label: 'bag fade pressed', timeoutMs: 10_000 }).catch(() => null);
        rec.shots.push(await shot(cdp, '09-bag-fade-applied'));
        const peek9 = await clickAndPeek(cdp, card('slot', 'fade'));
        const cleared9 = await until('bag in cleared', bagOf, b => b.motion?.in === undefined);
        await sleep(1200);
        const plays9 = await evalOn(cdp, 'window.__l1Plays');
        check('9. 袋: 押し直しで motion.in が消える', cleared9.ok, { motion: cleared9.value?.motion ?? null });
        check('9. 袋: 押された表示が即座に外れ、実演が走らない', peek9 === 'false' && plays9.length === 0, { pressedRightAfterClick: peek9, plays: plays9 });
        check('9. 袋: 袋 item の motion 以外は不変・captions.json は不変', isDeepStrictEqual({ ...cleared9.value, motion: undefined }, { ...bag0, motion: undefined }) && isDeepStrictEqual(await captionsOf(p.PJ), caps0), null);
        rec.shots.push(await shot(cdp, '09-bag-fade-cleared'));
        const undo9 = await cmdZ(cdp, 'c-0001', bagOf, b => b.motion?.in?.preset === 'fade');
        check('9. 袋: Cmd+Z 1 手で motion.in が戻る', undo9.ok, { via: undo9.via, motion: undo9.value?.motion });

        // 10. 袋の字幕: 強調を足してから「なし」（強調を選択中）→ loop だけ消え in は残る
        await openMotion(cdp, 'c-0001');
        await clickSwitch(cdp, '強調');
        await clickSel(cdp, card('slot', 'pulse'));
        const loop10 = await until('bag loop', bagOf, b => b.motion?.loop?.preset === 'pulse' && b.motion?.in?.preset === 'fade');
        await clickSwitch(cdp, 'なし');
        const cleared10 = await until('bag loop cleared', bagOf, b => b.motion?.loop === undefined);
        check('10. 袋: 「なし」（強調）で motion.loop だけ消え motion.in は残る', loop10.ok && cleared10.ok && cleared10.value?.motion?.in?.preset === 'fade', { motion: cleared10.value?.motion ?? null });

        // 11. 袋の字幕: 組「シンプル」→ 押し直しで motion がまとめて消える → Cmd+Z で戻る
        await openMotion(cdp, 'c-0001');
        await clickSel(cdp, card('combo', 'simple'));
        const combo11 = await until('bag combo', bagOf, b => b.motion?.in?.preset === 'fade' && b.motion?.out?.preset === 'fade');
        check('11. 袋: 組「シンプル」で motion.in / out = fade', combo11.ok, combo11.value?.motion);
        await waitEval(cdp, `${pressed(card('combo', 'simple'))}==='true'`, { label: 'bag combo pressed', timeoutMs: 10_000 }).catch(() => null);
        const comboPressed = await evalOn(cdp, pressed(card('combo', 'simple')));
        rec.steps.bagComboPressed = comboPressed;
        if (comboPressed === 'true') {
            const peek11 = await clickAndPeek(cdp, card('combo', 'simple'));
            const cleared11 = await until('bag combo cleared', bagOf, b => b.motion === undefined || (b.motion.in === undefined && b.motion.loop === undefined && b.motion.out === undefined));
            check('11. 袋: 組の押し直しで motion の in / loop / out がまとめて消える', cleared11.ok && peek11 === 'false', { pressedRightAfterClick: peek11, motion: cleared11.value?.motion ?? null });
            const undo11 = await cmdZ(cdp, 'c-0001', bagOf, b => b.motion?.in?.preset === 'fade' && b.motion?.out?.preset === 'fade');
            check('11. 袋: Cmd+Z 1 手で組が戻る', undo11.ok, { via: undo11.via, motion: undo11.value?.motion });
        } else {
            check('11. 袋: 組「シンプル」が押された表示になる（押し直しの前提）', false, { comboPressed });
        }
    }
    rec.status = 'recorded';
} catch (error) {
    rec.status = 'error'; rec.error = sanitize(error, REPO);
} finally {
    await stop(session);
    await writeFile(path.join(OUT, `results-${NAME}.json`), `${S(rec, null, 2).replaceAll(WORK, '<work>').replaceAll(REPO, '<worktree>')}\n`);
}
console.log(S({ status: rec.status, error: rec.error, pass: rec.checks.filter(c => c.ok).length, fail: rec.checks.filter(c => !c.ok).map(c => c.name) }));
