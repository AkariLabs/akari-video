// リアルタイム検証サーバー: マイク（SpeechAnalyzer）→ 途中経過ごとに Jev → 確信度を HUD へ流し、ゲートを通ったら edit.json を書き換える。
// 使い方: node live/live.mjs [--no-mic] [--file x.wav] [--port 4747]   → http://localhost:4747 を開く
// 記録: sessions/<開始時刻>.jsonl（認識結果・全判断・発火・○×ラベル）。これが「実データ」になる。
import { applyLive, deletedGhosts, resultEffects, reverseChange, safeErrorMessage } from './bridge.mjs';
import { createSttScheduler } from './stt-scheduler.mjs';
import { createP2PartialPredicate } from './partial-policy.mjs';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadFixture } from '../src/fixture.mjs';
import { timelineSnapshot } from '../src/v2/snapshot.mjs';

import { editStore } from '../src/edit-store.mjs';
import { audioAssets } from '../src/exec-support/audio_ops_sfx.mjs';
import { buildState as localState } from '../src/local-state.mjs';
import { normalize } from '../src/text-normalize.mjs';
import { selectionOfTarget } from '../src/target-geometry.mjs';
import { parseCaptionList } from './local-apply.mjs';
import { localGrammarAudit, localGrammarGeneration, prepareLocalGrammarFinal, resolveLocalGrammarOrJev } from './local-grammar.mjs';
import { planInspectorFocus } from './companion/inspector-focus.mjs';
import { planShellEffects } from './companion/shell-effects.mjs';
import { libraryTitlesForGrammar, libraryIntentShellEffect, prepareLibraryInsert, runWithLibraryRuntime, sendImportAssetWithTimeout } from './companion/library-insert.mjs';
import { createJudgeClient } from './companion/judge-client.mjs';
import crypto from 'node:crypto';
import os from 'node:os';
import { credentialStatus } from './companion/judge-client.mjs';
import { writeCompanionConfig } from './companion/home.mjs';
import { startCompanionServer } from './companion/server.mjs';
import { createInstructionSenders } from './companion/link.mjs';
import { ProjectContextTracker, emptyProject } from './companion/project-context.mjs';
import { sendApplyEdit } from './companion/apply-edit.mjs';
import { redactJudgeRequest } from './companion/redact-request.mjs';
let displayGate = {};
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const argv = process.argv.slice(2);
const SERVE = argv.includes('--serve');
const DEV = process.env.AKARI_VIBE_DEV === '1';
const helpers = new Set();
let productServer = null;
let stopping = false;
function stopProduct() {
    if (stopping) return;
    stopping = true;
    productServer?.handler.close();
    productServer?.server.closeAllConnections?.();
    productServer?.server.close();
    for (const child of helpers) child.kill('SIGTERM');
    setTimeout(() => {
        for (const child of helpers) child.kill('SIGKILL');
        process.exit(0);
    }, 100);
}
let serveToken;
if (SERVE) {
    console.log = (...args) => console.error(...args);
    process.on('SIGTERM', stopProduct);
    process.on('SIGINT', stopProduct);
    try {
        serveToken = await new Promise((resolve, reject) => {
            let buffer = '';
            let accepted = false;
            const invalid = () => reject(new Error('invalid handshake'));
            process.stdin.setEncoding('utf8');
            process.stdin.on('data', chunk => {
                if (accepted) return;
                buffer += chunk;
                const end = buffer.indexOf('\n');
                if (end < 0) { if (buffer.length > 1024) invalid(); return; }
                try {
                    const value = JSON.parse(buffer.slice(0, end));
                    if (end > 1024 || !value || Object.keys(value).length !== 1 || typeof value.token !== 'string' || !/^[a-f0-9]{64}$/i.test(value.token ?? '')) return invalid();
                    accepted = true; buffer = ''; resolve(value.token);
                } catch { invalid(); }
            });
            process.stdin.on('end', () => accepted ? stopProduct() : invalid());
            process.stdin.on('error', () => accepted ? stopProduct() : invalid());
            process.stdin.resume();
        });
    } catch { console.error('標準入力の合言葉が不正です'); process.exit(2); }
    if (stopping) await new Promise(() => {});
    if (!DEV && (argv.includes('--file') || (argv.includes('--mode') && argv[argv.indexOf('--mode') + 1] !== 'flat'))) {
        console.error('実験用の引数には AKARI_VIBE_DEV=1 が必要です'); process.exit(2);
    }
}
const PORT = argv.includes('--port') ? Number(argv[argv.indexOf('--port')+1]) : 4747;
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535) throw new Error('有効なポートを指定してください');
const COMPANION = SERVE || argv.includes('--companion');
const COMPANION_PORT = SERVE ? 0 : argv.includes('--companion-port') ? Number(argv[argv.indexOf('--companion-port')+1]) : 4749;
if (COMPANION && !SERVE && (!Number.isInteger(COMPANION_PORT) || COMPANION_PORT < 1024 || COMPANION_PORT > 65535
    || [4747, 4748, 4750, 4761, PORT].includes(COMPANION_PORT))) throw new Error('--companion-port は予約済みでない 1024〜65535 の整数で指定してください');
const STALE_MS = argv.includes('--stale-ms') ? Number(argv[argv.indexOf('--stale-ms')+1]) : 5000;
if (!Number.isSafeInteger(STALE_MS) || STALE_MS <= 0 || STALE_MS > 2147483647) throw new Error('--stale-ms は 1〜2147483647 の整数で指定してください');
const MODE = argv.includes('--mode') ? argv[argv.indexOf('--mode') + 1] : 'flat';
if (!['flat', 'staged'].includes(MODE)) throw new Error(`Unknown mode: ${MODE}`);
const USE_MIC = !argv.includes('--no-mic');
const FILE = argv.includes('--file') ? argv[argv.indexOf('--file') + 1] : null; // 録音済み wav を実時間で流す（マイクなしの通し確認用）
const EARLY_SEEK_ARG = argv.includes('--early-seek') ? argv[argv.indexOf('--early-seek') + 1] : 'on';
if (!['on', 'off'].includes(EARLY_SEEK_ARG)) throw new Error('--early-seek は on または off で指定してください');
let earlySeek = EARLY_SEEK_ARG === 'on';

// 節約: 途中経過は (1) 軽い質問だけ (2) 初回即時・以後最短 600ms (3) 雑談と判断した文は 8 文字増えるまで呼ばない
const PARTIAL_MIN_MS = 600, CHAT_BELOW = 0.2, CHAT_RECHECK_CHARS = 8, CARRY_MS = 8000;
const INPUT_USD_PER_TOKEN = 0.042 / 1_000_000;
// これだけ黙ったら、音声認識の確定（実測 1〜8 秒遅れる）を待たずに「言い終えた」とみなして判断する
const SILENCE_MS = 1100; // 実測: 0.8 秒の間で「タイトルのテロップをカット」が確定扱いになり削除された。正しく効いた例はすべて 1.2 秒以上

// Preserve lab's eager catalog readiness before accepting the first utterance.
// Product startup leaves both catalogs lazy, including when internal assets are absent.
if (!SERVE) {
    libraryTitlesForGrammar();
    void audioAssets.length;
    // Node initializes its Fetch response implementation on first access.
    // Keep that local startup cost out of the first lab judgment (no HTTP call).
    void globalThis.Response;
}
const initialProject = COMPANION ? emptyProject() : loadFixture();
let { context } = initialProject;
const { source: initialSource, captionsSource: initialCaptions } = initialProject;
const freshCtx = () => ({ playheadT: 0, selection: null, stroke: null, strokeCut: null, pointer: null });
let source = initialSource;
let captionsSource = initialCaptions; // 字幕の正本。音声の文字入れは edit.json の telop item。
let ctx = freshCtx();
let undoStack = [], redoStack = []; // 要素は { source, captionsSource, ctx, id, op, target, label, t }。編集と一緒に文字・再生ヘッド・選択も戻す
let editId = 0;
// 聞き返し・候補は undo の画面状態とは別に期限・履歴を管理する。
let lastAsk = null;
let lastCandidates = null;
let ghosts = [], tasks = [], banner = null, lastChange = null, lastChangedItemId = null;
let ui = { playing: false, loop: null, timelineScale: 1, revision: 0 };
let listening = !USE_MIC || Boolean(FILE), listenEpoch = 0, activeOperation = null, currentOperationId = null;
let scheduler;
let companionLink = null;
const projectTracker = COMPANION ? new ProjectContextTracker({ onUpdate(state, message) {
    if (message.type === 'light') {
        ctx = { ...ctx, playheadT: state.playheadT, selection: state.selection };
    } else if (state.ready) {
        source = state.source; captionsSource = state.captionsSource; context = state.context;
    }
    if (state.tooLarge) showBanner('文書が 8MB を超えているため声では編集できません');
    if (scheduler) send('snapshot', snapshot());
} }) : null;
const utterances = new Map();
const task = (text, target, reason, operationId = currentOperationId) => {
    const detail = String(reason ?? '');
    reason = Array.from(detail.split(' {', 1)[0]).slice(0, 80).join('');
    const entry = { id: `task-${Date.now()}-${tasks.length}`, operationId, text, target, reason, detail,
        needsReview: true, bulkEligible: false };
    tasks.push(entry); log({ type: 'task', ...entry });
};
function showBanner(text) { banner = { text, expiresAt: Date.now() + 5000 }; }
function setLibraryBanner(text) { banner = text ? { text, expiresAt: Date.now() + 5000 } : null; send('snapshot',snapshot()); }
const judgeClient=createJudgeClient({serve:SERVE,allowInsecureTransport:Boolean(globalThis.__inspectorFocusHandlers),onUserMessage:message=>{showBanner(message);send('snapshot',snapshot());}});
function expireTransient() {
    ghosts = ghosts.filter(g => Date.now() - g.deletedAt < 8000);
    if (banner && banner.expiresAt <= Date.now()) banner = null;
    if (lastAsk && lastAsk.expiresAt <= Date.now()) {
        task(lastAsk.text, lastAsk.pending.target, `[要確認] ${lastAsk.question}（返答なし）`, lastAsk.operationId);
        lastAsk = null;
    }
}
function setListening(on) {
    if (SERVE && on) {
        const status = productStatus();
        if (status.platform !== 'ok' || status.lab !== 'connected' || status.providerKey !== 'set' || status.mic === 'unsupported') return;
    }
    listening = on; listenEpoch++; scheduler.reset();
    if (on && USE_MIC && !FILE && !inputStarted) void startInput();
    activeOperation = null; range.tail = ''; carry = null; lastFinalSeen = null;
    log({ type: 'listen', on }); send('snapshot', snapshot());
}
setInterval(() => {
    const before = JSON.stringify([ghosts, lastAsk, banner]); expireTransient();
    if (before !== JSON.stringify([ghosts, lastAsk, banner])) send('snapshot', snapshot());
}, 150).unref();
let utt = 1;
let carry = null;                   // 「〜なんだけど。」で切れた言いかけ。次の発話の頭につなぐ
const history = [];                 // 確定した発話の判断（HUD を開き直しても復元する）
const stats = { calls: 0, cost: 0, inputTokens: 0, latencies: [] };
const utteranceCosts = new Map();
let lastCostOperationId = null;
// 音声認識の未確定区間。実行済みの文字・ID は utterances に保持する。
const range = { tail: '', tailAt: 0, tailJudged: null, seekFiredFor: null, flyFiredFor: null, chatLen: null };
const saved = { skippedPartials: 0, liteCalls: 0, fullCalls: 0 };
let lastFinalSeen = null;
// 声の検出（音量ベース）: 声→文字、言い終わり→確定 のラグを測り、無音での早期確定に使う
const voice = { floor: 0.003, active: false, onsetAt: null, lastVoiceAt: null, firstTextAt: null };

const sessionDirectory = SERVE ? process.env.AKARI_VIBE_LOG_DIR : process.env.AKARI_VOICE_SESSION_DIR || path.join(ROOT, 'sessions');
if (sessionDirectory) fs.mkdirSync(sessionDirectory, { recursive: true });
const sessionFile = sessionDirectory ? path.join(sessionDirectory, `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}.jsonl`) : null;
if (sessionFile) console.log(`記録: ${path.relative(process.cwd(), sessionFile)}`);
const t0 = Date.now();
const log = (o) => { if (sessionFile) fs.appendFileSync(sessionFile, JSON.stringify({ at: (Date.now() - t0) / 1000, ...o }) + '\n'); };

const clients = new Set();
const send = (type, data) => { const s = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`; for (const c of clients) c.write(s); };
const median = (a) => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null);

function snapshot() {
    expireTransient();
    const edit = JSON.parse(source);
    const rows = edit.tracks.map(t => ({ id: t.id, label: t.id }));
    const shot = timelineSnapshot({edit,context,ctx,captions:parseCaptionList(captionsSource)});
    for (const it of shot.items) it.trackId = editStore.locate(edit, it.id.replace(/^item:/, ''))?.track.id;
    return {
        ctx: { ...ctx, lastAsk, lastCandidates: candidateContext(), listening }, utt, ...shot, rows,
        ghosts, tasks, banner, lastChange, ui, listening, lastAsk, lastCandidates, inputStatus: micStatus, inputFileEnded: inputFileEndedAt !== null, inputFileEndedAt, busy: scheduler.busy, pending: scheduler.pending,
        done: undoStack.map(({ id, op, target, label, t, operationId, text }) => ({ id, op, target, label, t, operationId, text })),
        vision:context.vision,transcript:context.transcript,output:edit.output,captions:parseCaptionList(captionsSource),
        canUndo: undoStack.length > 0, canRedo: redoStack.length > 0,
        knob: knobView(source, captionsSource, selectedKnobId()),
        cost: { sessionUsd: stats.cost, sessionCalls: stats.calls, sessionInputTokens: stats.inputTokens,
            lastUtteranceUsd: utteranceCosts.get(lastCostOperationId)?.usd ?? 0,
            lastUtteranceCalls: utteranceCosts.get(lastCostOperationId)?.calls ?? 0 },
        mode: MODE, staleMs: STALE_MS, earlySeek, inputStarted, canStartInput: USE_MIC && !FILE,
        stats: { calls: stats.calls, cost: stats.cost, inputTokens: stats.inputTokens, p50: median(stats.latencies), ...saved }, gate: displayGate,
    };
}

function normalizeUsage(raw, fallbackCalls = 0) {
    const input_tokens = Number(raw?.input_tokens ?? 0) || 0;
    const apiCalls = Number(raw?.apiCalls ?? fallbackCalls) || 0;
    const explicit = Array.isArray(raw?.perCall) ? raw.perCall.some(call => call.cost != null) : raw?.cost != null;
    const supplied = Number(raw?.cost);
    const cost = explicit && Number.isFinite(supplied) ? supplied : input_tokens * INPUT_USD_PER_TOKEN;
    return { ...(raw ?? {}), input_tokens, apiCalls, cost };
}
function recordUsage(operationId, usage, lite, latencyMs) {
    stats.calls += usage.apiCalls; stats.inputTokens += usage.input_tokens; stats.cost += usage.cost;
    if (Number.isFinite(latencyMs)) stats.latencies.push(latencyMs);
    if (lite) saved.liteCalls += usage.apiCalls; else saved.fullCalls += usage.apiCalls;
    const prior = utteranceCosts.get(operationId) ?? { usd: 0, calls: 0, inputTokens: 0 };
    utteranceCosts.set(operationId, { usd: prior.usd + usage.cost, calls: prior.calls + usage.apiCalls,
        inputTokens: prior.inputTokens + usage.input_tokens });
    lastCostOperationId = operationId;
    return utteranceCosts.get(operationId);
}

const knobLabels = { x: '位置 x', y: '位置 y', scale: '大きさ', rotate: '回転', opacity: '不透明度', color: '色', text: '文言', start: '出るタイミング', duration: '長さ' };
const knobKeys = Object.keys(knobLabels);
function resolveRawItem(edit, itemId) {
    if (!itemId) return null;
    if (itemId.startsWith('cut:')) {
        const shot = timelineSnapshot({ edit, context, ctx, captions: parseCaptionList(captionsSource) });
        const cut = shot.cuts.find(c => c.id === itemId);
        return cut ? editStore.locate(edit, cut.itemId) : null;
    }
    return editStore.locate(edit, itemId.replace(/^item:/, ''));
}
function colorSlot(item) {
    if (item.source?.kind === 'telop') return ['params', 'color_text'];
    const vars = item.source?.vars;
    const key = vars && Object.keys(vars).find(k => /(?:accent|color)/i.test(k));
    return key ? ['vars', key] : null;
}
function knobView(sourceText, capsText, itemId) {
    if (!itemId || itemId.startsWith('caption:')) return null;
    const edit = JSON.parse(sourceText), located = resolveRawItem(edit, itemId);
    if (!located) return null;
    const item = located.item, fps = edit.output?.fps ?? 30;
    const shot = timelineSnapshot({ edit, context, ctx, captions: parseCaptionList(capsText) });
    const cut = shot.cuts.find(c => c.itemId === item.id), viewItem = shot.items.find(i => i.id === `item:${item.id}` || i.id === itemId);
    const slot = colorSlot(item), color = slot ? item.source?.[slot[0]]?.[slot[1]] ?? null : null;
    return { itemId: cut?.id ?? `item:${item.id}`, rawId: item.id, label: cut ? `カット${cut.n}` : viewItem?.label ?? item.id,
        fields: {
            x: item.transform?.x ?? 0, y: item.transform?.y ?? 0, scale: item.transform?.scale ?? 1,
            rotate: item.transform?.rotate ?? 0, opacity: item.opacity ?? 1, color,
            text: item.source?.kind === 'telop' ? item.source.params?.text ?? null : null,
            start: item.at / fps, duration: item.duration / fps,
        }, editable: { x:true, y:true, scale:true, rotate:true, opacity:true, color:Boolean(slot), text:item.source?.kind === 'telop', start:true, duration:true } };
}
function selectedKnobId() {
    const selected = Array.isArray(ctx.selection) ? ctx.selection[0] : ctx.selection;
    return knobView(source, captionsSource, selected) ? selected : lastChangedItemId;
}
function changeBetween(beforeSource, beforeCaps, afterSource, afterCaps, preferredId, origin = 'voice') {
    const before = JSON.parse(beforeSource), after = JSON.parse(afterSource);
    const ids = [];
    for (const track of [...before.tracks, ...after.tracks]) for (const item of track.items ?? []) if (!ids.includes(item.id)) ids.push(item.id);
    const preferred = preferredId && (preferredId.startsWith('item:') || preferredId.startsWith('cut:')) ? preferredId : null;
    const candidates = preferred ? [preferred, ...ids.map(id => `item:${id}`)] : ids.map(id => `item:${id}`);
    let fallback = null;
    for (const id of candidates) {
        const a = knobView(beforeSource, beforeCaps, id), b = knobView(afterSource, afterCaps, id);
        const basis = b ?? a;
        if (!basis) continue;
        const fields = knobKeys.filter(key => JSON.stringify(a?.fields?.[key] ?? null) !== JSON.stringify(b?.fields?.[key] ?? null))
            .map(key => ({ key, before: a?.fields?.[key] ?? null, after: b?.fields?.[key] ?? null }));
        if (id === preferred) fallback = { itemId: basis.itemId, label: basis.label, fields, origin, changedAt: Date.now() };
        if (fields.length) return { itemId: basis.itemId, label: basis.label, fields, origin, changedAt: Date.now() };
    }
    return fallback ?? (preferred ? { itemId: preferred, label: preferred, fields: [], origin, changedAt: Date.now() } : null);
}
function updateKnob(itemId, key, rawValue) {
    if (!knobKeys.includes(key)) throw new Error('編集できないツマミです');
    const edit = JSON.parse(source), current = knobView(source, captionsSource, itemId);
    if (!current?.editable?.[key]) throw new Error('この対象では編集できないツマミです');
    const located = editStore.locate(edit, current.rawId);
    if (!located) throw new Error('対象が見つかりません');
    const item = located.item, fps = edit.output?.fps ?? 30;
    if (key === 'text') item.source.params.text = String(rawValue);
    else if (key === 'color') {
        const slot = colorSlot(item); if (!slot) throw new Error('色のツマミがありません');
        item.source[slot[0]][slot[1]] = String(rawValue);
    } else {
        const value = Number(rawValue);
        if (!Number.isFinite(value)) throw new Error('数値を入力してください');
        if (key === 'start') item.at = Math.max(0, Math.round(value * fps));
        else if (key === 'duration') item.duration = Math.max(1, Math.round(value * fps));
        else if (key === 'opacity') item.opacity = Math.max(0, Math.min(1, value));
        else {
            item.transform ??= {};
            item.transform[key] = key === 'scale' ? Math.max(0.01, value) : value;
        }
    }
    return JSON.stringify(edit);
}

function commit(next, nextCtx, why, nextCaptions = captionsSource, decision = {}) {
    editStore.readEditV2(JSON.parse(next));
    const beforeSource = source, beforeCaptions = captionsSource;
    const preferred = selectionOfTarget(decision.target, JSON.parse(source)) ?? (Array.isArray(nextCtx.selection) ? nextCtx.selection[0] : nextCtx.selection);
    const origin = currentOperationId?.startsWith('manual-') ? 'manual' : 'voice';
    if (next === source && nextCaptions === captionsSource) {
        ctx = nextCtx;
        lastChange = changeBetween(source, captionsSource, next, nextCaptions, preferred, origin)
            ?? { itemId: preferred ?? null, label: preferred ?? '対象', fields: [], origin, changedAt: Date.now() };
        if (preferred) lastChangedItemId = preferred;
        return;
    }
    const op = decision.op ?? why;
    // t は実行時の Unix 時刻（ミリ秒）。undo/redo でも id と t を維持する。
    const id = `edit-${++editId}`;
    const addedGhosts = deletedGhosts(source, next, captionsSource, nextCaptions, context, ctx, id);
    const change = changeBetween(beforeSource, beforeCaptions, next, nextCaptions, preferred, origin);
    undoStack.push({ source, captionsSource, ctx: structuredClone(ctx), afterSource: next, afterCaptions: nextCaptions,
        ghostsBefore: structuredClone(ghosts), ghostsAfter: [...ghosts, ...addedGhosts],
        operationId: currentOperationId, text: utterances.get(currentOperationId)?.rawText ?? why, id, op,
        target: decision.target ?? null, label: decision.opLabel ?? op, change, t: Date.now() }); redoStack = [];
    ghosts.push(...addedGhosts); source = next; captionsSource = nextCaptions; ctx = nextCtx;
    if (change) { lastChange = change; lastChangedItemId = change.itemId; }
    log({ type: 'edit', utt, operationId: currentOperationId, why });
}
function moveHistoryLocal(from, to, why) {
    if (!from.length) return false;
    const beforeSource = source, beforeCaptions = captionsSource;
    const entry = from.pop();
    to.push({ ...entry, source, captionsSource, ctx: structuredClone(ctx) });
    ({ source, captionsSource, ctx } = entry);
    ghosts = structuredClone(why === 'undo' ? entry.ghostsBefore ?? [] : entry.ghostsAfter ?? []);
    lastChange = changeBetween(beforeSource, beforeCaptions, source, captionsSource, entry.change?.itemId, why);
    if (lastChange) { lastChangedItemId = lastChange.itemId; }
    expireTransient(); log({ type: 'edit', utt, operationId: currentOperationId, why }); return true;
}
async function moveHistory(from, to, why) {
    if (!COMPANION) return moveHistoryLocal(from, to, why);
    if (!from.length) return false;
    const entry=from.at(-1);let beforeSource=source,beforeCaptions=captionsSource;
    const computePlan=()=>{
        const undoing=why==='undo';
        const edit=reverseChange(JSON.parse(undoing?entry.source:entry.afterSource),JSON.parse(undoing?entry.afterSource:entry.source),JSON.parse(source));
        const captions=reverseChange((undoing?entry.captionsSource:entry.afterCaptions)&&JSON.parse(undoing?entry.captionsSource:entry.afterCaptions),
            (undoing?entry.afterCaptions:entry.captionsSource)&&JSON.parse(undoing?entry.afterCaptions:entry.captionsSource),captionsSource&&JSON.parse(captionsSource));
        return {next:JSON.stringify(edit),caps:captions==null?null:JSON.stringify(captions)};
    };
    let plan=computePlan();
    const makeInput=()=>({projectSessionId:projectTracker.state.projectSessionId,label:why==='undo'?'戻す':'やり直す',
        before:{editHash:projectTracker.state.editHash,captionsHash:projectTracker.state.captionsHash},
        next:{...(plan.next!==source?{editText:plan.next}:{}),...(plan.caps!==captionsSource?{captionsText:plan.caps}:{})},plan});
    const startHashes={editHash:projectTracker.state.editHash,captionsHash:projectTracker.state.captionsHash};
    const sent=await sendApplyEdit(makeInput(),companionLink,{
        async rebuild(){const latest=await projectTracker.waitForDocsChange(startHashes);source=latest.source;captionsSource=latest.captionsSource;context=latest.context;
            beforeSource=source;beforeCaptions=captionsSource;plan=computePlan();return makeInput();},
        task:reason=>task(why,null,reason),log:message=>log({type:'error',message}),banner:showBanner,
    });
    if(!sent.ok)return false;
    plan=sent.input.plan;
    from.pop();to.push({...entry,source,captionsSource,ctx:structuredClone(ctx)});
    source=plan.next;captionsSource=plan.caps;ctx=structuredClone(entry.ctx);
    ghosts=structuredClone(why==='undo'?entry.ghostsBefore??[]:entry.ghostsAfter??[]);
    lastChange=changeBetween(beforeSource,beforeCaptions,source,captionsSource,entry.change?.itemId,why);
    if(lastChange)lastChangedItemId=lastChange.itemId;
    const hashes=sent.result.value??{};projectTracker.acceptApplied({editText:source,captionsText:captionsSource,editSha256:hashes.editSha256,captionsSha256:hashes.captionsSha256});
    expireTransient();log({type:'edit',utt,operationId:currentOperationId,why});return true;
}
function undo() { return typeof COMPANION !== 'undefined' && COMPANION
    ? moveHistory(undoStack, redoStack, 'undo') : moveHistoryLocal(undoStack, redoStack, 'undo'); }
function redo() { return typeof COMPANION !== 'undefined' && COMPANION
    ? moveHistory(redoStack, undoStack, 'redo') : moveHistoryLocal(redoStack, undoStack, 'redo'); }
async function undoEntry(id) {
    const index = undoStack.findIndex(e => e.id === id);
    if (index < 0) return false;
    if (index === undoStack.length - 1) return await undo();
    const e = undoStack[index];
    const computePlan=()=>{
        const next=JSON.stringify(reverseChange(JSON.parse(e.source),JSON.parse(e.afterSource),JSON.parse(source)));
        const caps=reverseChange(e.captionsSource&&JSON.parse(e.captionsSource),e.afterCaptions&&JSON.parse(e.afterCaptions),captionsSource&&JSON.parse(captionsSource));
        editStore.readEditV2(JSON.parse(next));
        // Rebase later undo snapshots too, so undo cannot resurrect the removed edit.
        const later=undoStack.slice(index+1).map(h=>({...h,
            source:JSON.stringify(reverseChange(JSON.parse(e.source),JSON.parse(e.afterSource),JSON.parse(h.source))),
            afterSource:JSON.stringify(reverseChange(JSON.parse(e.source),JSON.parse(e.afterSource),JSON.parse(h.afterSource))),
            captionsSource:JSON.stringify(reverseChange(e.captionsSource&&JSON.parse(e.captionsSource),e.afterCaptions&&JSON.parse(e.afterCaptions),h.captionsSource&&JSON.parse(h.captionsSource))),
            afterCaptions:JSON.stringify(reverseChange(e.captionsSource&&JSON.parse(e.captionsSource),e.afterCaptions&&JSON.parse(e.afterCaptions),h.afterCaptions&&JSON.parse(h.afterCaptions))),
            ghostsBefore:h.ghostsBefore.filter(g=>g.editId!==id),ghostsAfter:h.ghostsAfter.filter(g=>g.editId!==id)}));
        return {next,nextCaps:caps==null?null:JSON.stringify(caps),later};
    };
    let plan=computePlan();
    if(COMPANION){
        const startHashes={editHash:projectTracker.state.editHash,captionsHash:projectTracker.state.captionsHash};
        const makeInput=()=>({projectSessionId:projectTracker.state.projectSessionId,label:'戻す',
            before:{editHash:projectTracker.state.editHash,captionsHash:projectTracker.state.captionsHash},
            next:{...(plan.next!==source?{editText:plan.next}:{}),...(plan.nextCaps!==captionsSource?{captionsText:plan.nextCaps}:{})},plan});
        const sent=await sendApplyEdit(makeInput(),companionLink,{async rebuild(){
            const latest=await projectTracker.waitForDocsChange(startHashes);source=latest.source;captionsSource=latest.captionsSource;context=latest.context;
            plan=computePlan();return makeInput();},
            task:reason=>task('undo-entry',null,reason),log:message=>log({type:'error',message}),banner:showBanner});
        if(!sent.ok)return false;
        plan=sent.input.plan;
        const hashes=sent.result.value??{};projectTracker.acceptApplied({editText:plan.next,captionsText:plan.nextCaps,editSha256:hashes.editSha256,captionsSha256:hashes.captionsSha256});
    }
    source = plan.next; captionsSource = plan.nextCaps;
    undoStack.splice(index, undoStack.length-index, ...plan.later); redoStack = [];
    ghosts = ghosts.filter(g => g.editId !== id);
    lastChange = changeBetween(e.afterSource, e.afterCaptions, e.source, e.captionsSource, e.change?.itemId, 'undo');
    if (lastChange) { lastChangedItemId = lastChange.itemId; }
    log({ type: 'edit', why: 'undo-entry', id }); return true;
}

// 再生・倍率・ループの意図を実物のプレビューへ渡す。
// 実行の係は env.ui に「意図」を書くだけで、画面への反映は呼び出し側（ここ）の仕事。
function sendPlayback(intent, merged){
    const senders=companionSenders();
    if(!senders||!intent||typeof intent!=='object')return;
    if(typeof intent.playing==='boolean')void senders.sendCommand(intent.playing?'akari.preview.play':'akari.preview.pause',{});
    if(Number.isFinite(intent.seekTo)){
        void senders.sendCommand('akari.timeline.seek',{seconds:intent.seekTo});
        void senders.sendCommand('akari.preview.seekOutput',{time:intent.seekTo});
    }
    if(intent.loop&&Number.isFinite(intent.loop.start)&&Number.isFinite(intent.loop.end)){
        void senders.sendCommand('akari.preview.setLoopRange',{startSeconds:intent.loop.start,endSeconds:intent.loop.end});
    } else if(intent.loop===null){
        void senders.sendCommand('akari.preview.setLoopRange',{clear:true});
    }
    if(intent.timelineZoom==='fit'){
        void senders.sendCommand('akari.preview.setViewZoom',{fit:true});
        if(intent.timelineRange)void senders.sendCommand('akari.timeline.setView',{startSeconds:intent.timelineRange.start,durationSeconds:intent.timelineRange.end-intent.timelineRange.start});
    } else if(intent.timelineZoom?.factor){
        // 倍率はシェルの現在値を知らないので、係が持っている合算値を渡す
        void senders.sendCommand('akari.preview.setViewZoom',{scale:merged.timelineScale});
    }
}

// 「連れていく」を実物のシェルへ渡す（決定 1 = 段 1 は連れていくが主役）。
// これまで手元の ctx を書き換えるだけで、実物の画面は動いていなかった（2026-09-20 実機で観測）。
function companionSenders(){
    if(!COMPANION||!companionLink)return null;
    return createInstructionSenders(companionLink,()=>projectTracker.state.projectSessionId);
}
function selectionItemId(selection,sourceText=source){
    const id=Array.isArray(selection)?selection[0]:selection;
    if(typeof id!=='string'||id.startsWith('caption:'))return null;
    // cut:<n> は edit.json 上の id ではないので、いま組んである状態から実物の id を引く
    let itemId=id.startsWith('item:')?id.slice(5):null;
    if(!itemId&&id.startsWith('cut:')){
        try{
            const st=localState({edit:JSON.parse(sourceText),context,ctx,text:'',captions:parseCaptionList(captionsSource)});
            itemId=st.segments.find(seg=>String(seg.index+1)===id.slice(4))?.itemId ?? null;
        }catch{itemId=null;}
    }
    return itemId;
}
function dispatchShellEffects(instructions){
    const senders=companionSenders();
    if(!senders||!instructions.length)return Promise.resolve();
    const operationId=currentOperationId;
    return (async()=>{
        for(const instruction of instructions){
            if(instruction.kind==='command'){
                // Let the selection/edit render land before asking the preview
                // to pulse the changed element.
                if(instruction.command.commandId==='akari.preview.pulseItem')
                    await new Promise(resolve=>setTimeout(resolve,50));
                await senders.sendCommand(instruction.command.commandId,instruction.command.args);
            }
            else if(instruction.kind==='flyTo')await senders.sendFlyTo(instruction.flyTo.target);
        }
    })().catch(error=>log({type:'error',operationId,message:safeErrorMessage(error)}));
}

// ---- 判断 1 回ぶん。final = 音声認識の確定または無音での早期確定。
let lastExecuted = null; // 直前に実行した編集の判断（「もう一回」でくり返す）
const candidateContext = () => lastCandidates ? { kind: lastCandidates[0]?.kind ?? 'library', items: lastCandidates.map(c=>({key:c.id,label:c.label})) } : null;
const judgeCtx = () => ({ ...ctx, lastAsk, lastCandidates: candidateContext(), libraryCandidates: lastCandidates?.filter(c => c.kind === 'library').map(c => c.id), listening, ui,
    history: undoStack.slice().reverse().map(({ id, op, target, label, t }) => ({ id, op, target, label, t })), canUndo: undoStack.length > 0, canRedo: redoStack.length > 0, lastOp: lastCandidates?.some(c => c.kind === 'audio') ? lastCandidates.map(c => c.id).join(' ') : lastExecuted ? lastExecuted.opLabel : null });
async function judge(item) {
    let { text, final, early, receivedAt, lags, noSplit, operationId, epoch } = item;
    const utterance = utterances.get(operationId);
    const stale = () => !listening || epoch !== listenEpoch || Date.now()-receivedAt >= STALE_MS || ((early || !final) && utterance?.closed && !item.promotedFinal);
    if (stale()) { log({type:'discard',operationId,reason:'stale-before-judge'}); return false; }
    if (COMPANION && (!projectTracker.state.ready || projectTracker.state.tooLarge)) {
        showBanner(projectTracker.state.tooLarge ? '文書が 8MB を超えているため判断できません' : 'シェルのプロジェクト状態を待っています');
        send('snapshot', snapshot());
        return false;
    }
    currentOperationId = operationId; expireTransient();
    const edit = JSON.parse(source), lite = !final;
    const fullRequest = { requestId:operationId, text, final, early:Boolean(early), noSplit:Boolean(noSplit), mode:MODE, lite,
        edit, captionsSource, context, ctx:{...judgeCtx(), judgeRuntime:{lastExecuted,earlySeek,seekFiredFor:range.seekFiredFor}} };
    const request = COMPANION ? redactJudgeRequest(fullRequest) : fullRequest;
    let timeout;
    const selected=await resolveLocalGrammarOrJev(item,{operationId,requestJev:signal=>Promise.race([judgeClient.judge(request,{signal}),
        new Promise(resolve=>{timeout=setTimeout(()=>resolve(null),Math.max(0,STALE_MS-(Date.now()-receivedAt)));})]).finally(()=>clearTimeout(timeout))});
    if(selected.supersededGeneration!=null)log({type:'discard',operationId,reason:'superseded-jev-generation',generation:selected.supersededGeneration});
    const response=selected.response;
    if (!response) { log({type:'discard',operationId,reason:'timeout'}); return false; }
    let r = response;
    const usage=normalizeUsage(r.usage,r.calls), utteranceCost=recordUsage(operationId,usage,lite,r.latencyMs);
    if(item.promotedFinal) { receivedAt=item.promotedFinal.receivedAt ?? receivedAt; lags=item.promotedFinal.lags ?? lags; final=true;early=false; r=item.promotedFinal.localGrammar?.response??response.promotedFinal; }
    if(stale()) { log({type:'decision',operationId,text,final,early:Boolean(early),discarded:'stale',usage,utteranceCost,decision:r.decision,conf:r.conf,answers:r.answers});return {wasFinal:false,complete:r.decision?.complete,stateKey:item.stateKey}; }
    const {intents,display,lifecycle}=r;
    displayGate=display.gate ?? {};
    final=lifecycle.final; early=lifecycle.early;
    const d=r.decision, conf=r.conf, fired=[...r.fired];let held=intents.held;
    for(const event of r.events)log(event);
    if(lifecycle.discarded){log({type:'decision',operationId,text,final,discarded:lifecycle.discarded,usage,utteranceCost,decision:d,conf,answers:r.answers});return {wasFinal:false,complete:d.complete,stateKey:item.stateKey};}
    if(intents.split) {
        scheduler.prepend(intents.split.map(text=>({kind:'final',text,final:true,noSplit:true,receivedAt,lags,operationId,epoch})));
        const payload={utt:operationId,operationId,text,final:false,latencyMs:r.latencyMs,decision:d,conf,fired:[],held:null,lags:{},
            note:`操作が ${intents.split.length} つ → 分けて順に実行`,usage,utteranceCost,probs:display.probs,extra:{direction:'—',color:'none',amount:1,position:'none'},labels:display.labels};
        send('decision',payload);log({type:'decision',...payload,answers:r.answers,state:r.state});log({type:'split',utt:operationId,text,clauses:intents.split});return {wasFinal:false,complete:d.complete,stateKey:item.stateKey};
    }
    if(Object.hasOwn(lifecycle,'chatLen'))range.chatLen=lifecycle.chatLen;
    if(intents.navigate)ctx.playheadT=intents.navigate.at;
    if(intents.select)ctx.selection=intents.select.selection;
    const inspectorSelection=intents.select?.selection??selectionOfTarget(d.target,edit);
    // 「その行だけ」の表示は、それを知っている版のシェルにだけ頼む（合図 = docs に location が入っていること。
    // 知らない版へ solo を送ると、公開側の引数の検査で inspector.open ごと弾かれる）
    const inspectorPlan=planInspectorFocus({soloSupported:Boolean(projectTracker?.state?.location),final,decision:d,conf:r.conf,editGate:r.editGate,held,
        reject:r.reject,missingArgs:r.missingArgs,
        executed:Boolean(intents.execute),edit,selection:inspectorSelection,selectionAlreadySent:Boolean(intents.select)});
    // Selecting first is required: the ordered shell-effects plan places it
    // before inspector.open, otherwise the requested field may not exist.
    const effectSelection=intents.select?.selection
        ?? (inspectorPlan?.selection&&!inspectorPlan.selectionAlreadySent?inspectorPlan.selection:null);
    const effectSelectionItemId=selectionItemId(effectSelection);
    const libraryIntent=COMPANION&&final?libraryIntentShellEffect({decision:d,confidence:r.conf,insertGate:displayGate.edit?.destructive,ctx:judgeCtx(),location:projectTracker.state.location,text}):{};
    const preShellEffects=planShellEffects({navigateAt:intents.navigate?.at,selection:effectSelection,
        selectionItemId:effectSelectionItemId,
        previewSelection:Boolean(intents.select)&&!inspectorPlan&&!intents.execute,
        inspectorOpenArgs:inspectorPlan?.openArgs??null,catalogOpen:libraryIntent.catalogOpen??null,
        flyAlreadySent:range.flyFiredFor===operationId});
    const preShellDispatch=dispatchShellEffects(preShellEffects);
    if(preShellEffects.some(instruction=>instruction.kind==='flyTo'))range.flyFiredFor=operationId;
    range.seekFiredFor=lifecycle.seekFiredFor;
    if(intents.undoRedo) {
        const {op,count,repeat}=intents.undoRedo;
        let n=0;while(n<count && await (op==='undo'?undo():redo()))n++;
        fired.push(repeat ? `repeat ${op}: ${n ? '1 回ぶん実行':'もう無い'}` : n ? `${op}: ${n} 回ぶん${op==='undo'?'取り消した':'やり直した'}${n<count?`（${count} 回と言われたが、あるのは ${n} 回ぶん）`:''}` : `${op}: ${op==='undo'?'取り消す':'やり直す'}編集がない`);
    }
    let applied=true,changedItemIdForEffects=null,shellCommandsForEffects=[],libraryShellEffectsForPost=[];
    if(intents.execute)try {
        const instruction=intents.execute,base=instruction.base;
        if (!COMPANION) {
            let cur=source,curCaps=captionsSource,curCtx={...judgeCtx(),rawText:utterance?.rawText ?? text},logs=[];
            for(let i=0;i<instruction.count;i++) {
                const e2=JSON.parse(cur),st2=localState({edit:e2,context,ctx:curCtx,captions:parseCaptionList(curCaps)});
                const res=applyLive({source:cur,edit:e2,ctx:curCtx,segments:st2.segments,context,captionsSource:curCaps,persons:st2.persons},{...instruction.d,rawText:utterance?.rawText ?? text},ui);
                receiveEffects(res,text,base);cur=res.source;curCaps=res.captionsSource;curCtx={...curCtx,playheadT:res.playheadT,...(res.selection!==undefined?{selection:res.selection}:{})};delete curCtx.rawText;logs.push(...res.log);
            }
            const gone=base.op==='delete' && ctx.selection===selectionOfTarget(base.target,edit);
            commit(cur,{...curCtx,selection:gone?null:curCtx.selection},instruction.repeat?`repeat ${base.op}`:d.op,curCaps,{...base,opLabel:instruction.label});
            fired.push(...(instruction.repeat?logs.map(l=>`もう一回: ${l}`):logs));
        } else {
            const senders=createInstructionSenders(companionLink,()=>projectTracker.state.projectSessionId);
            // shell_ui_open is dispatched once by the ordered effect planner
            // after apply has accepted the decision. Capture what its executor
            // actually attempts; the planner deduplicates the legacy two paths.
            const capturedShellCommands=[];
            const executionSenders=base.op==='shell_ui_open'
                ? {...senders,sendCommand:(commandId,args)=>{
                    capturedShellCommands.push({commandId,args});return Promise.resolve({ok:true});
                }}:senders;
            const applyFrom=async(startSource,startCaps,startContext,startCtx,sideEffects=true)=>{
                let cur=startSource,curCaps=startCaps,curCtx={...startCtx,rawText:utterance?.rawText ?? text},logs=[],results=[],libraryShellEffects=[],applyLabel=null;
                for(let i=0;i<instruction.count;i++) {
                    const e2=JSON.parse(cur),st2=localState({edit:e2,context:startContext,ctx:curCtx,captions:parseCaptionList(curCaps)});
                    const prepared=await prepareLibraryInsert({decision:{...instruction.d,rawText:utterance?.rawText ?? text},confidence:r.conf,insertGate:displayGate.edit?.destructive,
                        ctx:curCtx,edit:e2,playheadT:curCtx.playheadT,persons:st2.persons,companion:true,
                        location:projectTracker.state.location,sendImportAsset:assetId=>sendImportAssetWithTimeout(companionLink,assetId),setBanner:setLibraryBanner});
                    const res=runWithLibraryRuntime(prepared.runtime,()=>applyLive({source:cur,edit:e2,ctx:curCtx,segments:st2.segments,
                        context:startContext,captionsSource:curCaps,persons:st2.persons,companion:true,...executionSenders},prepared.decision,ui));
                    await Promise.all(res.pendingEffects ?? []);
                    if(sideEffects)results.push(res);
                    libraryShellEffects.push(prepared.shellEffect);
                    applyLabel??=prepared.applyLabel;
                    cur=res.source;curCaps=res.captionsSource;curCtx={...curCtx,playheadT:res.playheadT,...(res.selection!==undefined?{selection:res.selection}:{})};delete curCtx.rawText;logs.push(...res.log);
                }
                return {cur,curCaps,curCtx,logs,results,libraryShellEffects,applyLabel,startSource,startCaps,startContext};
            };
            let local=await applyFrom(source,captionsSource,context,judgeCtx());
            const finishLocal=chosen=>{
                for(const result of chosen.results)receiveEffects(result,text,base);
                libraryShellEffectsForPost=chosen.libraryShellEffects;
                if(base.op==='shell_ui_open'&&chosen.logs.some(line=>line.includes('→ 開いた')&&!line.includes('未適用')))
                    shellCommandsForEffects=capturedShellCommands;
                const gone=base.op==='delete' && ctx.selection===selectionOfTarget(base.target,JSON.parse(chosen.startSource));
                commit(chosen.cur,{...chosen.curCtx,selection:gone?null:chosen.curCtx.selection},instruction.repeat?`repeat ${base.op}`:d.op,chosen.curCaps,{...base,opLabel:chosen.applyLabel??instruction.label});
                fired.push(...(instruction.repeat?chosen.logs.map(line=>`もう一回: ${line}`):chosen.logs));
            };
            if(local.cur===local.startSource && local.curCaps===local.startCaps) {
                finishLocal(local);
            } else {
                const before={editHash:projectTracker.state.editHash,captionsHash:projectTracker.state.captionsHash};
                const makeInput=chosen=>({projectSessionId:projectTracker.state.projectSessionId,
                    label:chosen.applyLabel??(instruction.repeat?`repeat ${base.op}`:instruction.label??d.op),before,
                    next:{...(chosen.cur!==chosen.startSource?{editText:chosen.cur}:{}),
                        ...(chosen.curCaps!==chosen.startCaps?{captionsText:chosen.curCaps}: {})},local:chosen});
                const sent=await sendApplyEdit(makeInput(local),companionLink,{
                    async rebuild(){
                        const latest=await projectTracker.waitForDocsChange(before);
                        context=latest.context;source=latest.source;captionsSource=latest.captionsSource;
                        local=await applyFrom(source,captionsSource,context,judgeCtx(),false);
                        return {projectSessionId:latest.projectSessionId,label:local.applyLabel??instruction.label??d.op,
                            before:{editHash:latest.editHash,captionsHash:latest.captionsHash},
                            next:{...(local.cur!==local.startSource?{editText:local.cur}:{}),
                                ...(local.curCaps!==local.startCaps?{captionsText:local.curCaps}:{})},local};
                    },
                    task:reason=>task(utterance?.rawText??text,base.target??ctx.selection,reason),
                    log:message=>log({type:'error',operationId,message}),banner:showBanner,
                });
                if(!sent.ok) { applied=false; held={reason:'シェルへ編集を反映できませんでした'}; }
                else {
                    local=sent.input.local;finishLocal(local);
                    const hashes=sent.result.value??{};
                    projectTracker.acceptApplied({editText:local.cur,captionsText:local.curCaps,
                        editSha256:hashes.editSha256,captionsSha256:hashes.captionsSha256});
                    if(local.cur!==local.startSource){
                        const direct=lastChangedItemId?.startsWith('item:')?lastChangedItemId.slice(5):null;
                        const original=selectionItemId(selectionOfTarget(base.target,JSON.parse(local.startSource)),local.startSource);
                        const candidate=direct??original;
                        if(candidate&&editStore.locate(JSON.parse(source),candidate))changedItemIdForEffects=candidate;
                    }
                }
            }
        }
    }catch(e){applied=false;held={reason:`適用エラー: ${e.message}`};}
    const postShellEffects=planShellEffects({final,decision:d,executed:Boolean(intents.execute)&&applied,
        changedItemId:changedItemIdForEffects,shellCommands:shellCommandsForEffects,
        catalogOpen:libraryShellEffectsForPost.find(effect=>effect.catalogOpen)?.catalogOpen??null,
        zoneHint:libraryShellEffectsForPost.find(effect=>effect.zoneHint)?.zoneHint??null,
        flyAlreadySent:range.flyFiredFor===operationId});
    if(postShellEffects.some(instruction=>instruction.kind==='flyTo'))range.flyFiredFor=operationId;
    void preShellDispatch.then(()=>dispatchShellEffects(postShellEffects));
    if(applied && lifecycle.lastExecuted) { lastExecuted={...lifecycle.lastExecuted,opLabel:display.opLabel}; }
    if(lifecycle.task) { const t=lifecycle.task;task(t.text,t.target,t.reason,t.operationId ?? operationId); }
    if(final)carry=intents.carry?{text,at:Date.now()}:null;
    if(lifecycle.clearAsk)lastAsk=null;
    if(intents.ask)lastAsk={...intents.ask,expiresAt:Date.now()+8000};
    const payload={utt:operationId,operationId,text,final,early:early&&final?true:undefined,latencyMs:r.latencyMs,decision:d,conf,fired,held,
        lags:{...(lags??{}),textToDecision:receivedAt?Date.now()-receivedAt:null},carried:final&&carry?true:undefined,
        probs:display.probs,lite:lite||undefined,extra:display.extra,labels:display.labels,usage,utteranceCost,risk:r.risk,editGate:r.editGate,reject:r.reject,missingArgs:r.missingArgs,...localGrammarAudit(r,applied)};
    log({type:'decision',...payload,answers:r.answers,state:final?r.state:undefined});send('decision',payload);
    if(fired.length||final)send('snapshot',snapshot());
    if(final){history.push(payload);range.seekFiredFor=null;range.flyFiredFor=null;ctx={...ctx,stroke:null,strokeCut:null,pointer:fired.some(f=>f.startsWith('move_pos'))?null:ctx.pointer};send('snapshot',snapshot());}
    return {wasFinal:final,complete:d.complete,stateKey:item.stateKey};
}

function receiveEffects(res, text, d) {
    const effects = resultEffects(res);
    if (effects.answer) showBanner(effects.answer);
    if (effects.screen) showBanner(effects.screen);
    if (effects.candidates) { lastCandidates = effects.candidates; ctx = { ...ctx, lastCandidates, libraryCandidates: lastCandidates.filter(c=>c.kind === 'library').map(c=>c.id) }; }
    if (effects.tasks.length) task(utterances.get(currentOperationId)?.rawText ?? text, d.targets ?? d.target ?? ctx.selection, effects.tasks.join(' / '));
    if (res.ui) {
        const zoom = res.ui.timelineZoom;
        delete ui.seekTo; delete ui.timelineZoom;
        ui = { ...ui, ...res.ui, timelineScale: zoom === 'fit' ? 1 : zoom?.factor ? ui.timelineScale * zoom.factor : ui.timelineScale, revision: ui.revision+1 };
        ui.timelineScale = Math.max(1, Math.min(16,ui.timelineScale));
        log({ type: 'ui', operationId: currentOperationId, ui });
        sendPlayback(res.ui, ui);
    }
    if (res.log.some(l=>l.includes('聞き返しを閉じる'))) { lastAsk = null; lastCandidates = null; }
    const listen = res.log.find(l => l.startsWith('聞き取り '));
    if (listen) setListening(listen.includes('resume'));
}

async function processScheduled(item) {
    const record = utterances.get(item.operationId);
    if (!record || item.epoch !== listenEpoch) return {};
    try {
        if (item.recognizerFinal && record.executedText) {
            if (!normalize(item.text).startsWith(record.executedText)) {
                for (const e of undoStack.filter(e=>e.operationId===item.operationId).reverse()) await undoEntry(e.id);
                tasks = tasks.filter(t=>t.operationId !== item.operationId);
                lastAsk = null; lastCandidates = record.beforeCandidates; lastExecuted = record.beforeLastExecuted;
                ui = { ...record.beforeUi, revision: ui.revision+1 }; ctx = { ...ctx, ...record.beforeCtx };
                redoStack = []; carry = null; range.seekFiredFor = null; range.flyFiredFor = null;
                showBanner('言い直しを反映'); send('note', { utt: item.operationId, text: '言い直しを反映' });
            } else {
                item.text = normalize(item.text).slice(record.executedText.length).replace(/^[。、 　]+/, '');
                if (!item.text) return {};
            }
        }
        if (item.recognizerFinal) {
            const parts = splitSentences(item.text);
            if (parts.length > 1) {
                scheduler.prepend(parts.map(text=>({ ...item,kind:'final',text,recognizerFinal:false })));
                return {};
            }
        }
        const result = await judge(item);
        if (item.early && result?.wasFinal) record.executedText = normalize(item.text);
        return result;
    } catch (e) {
        const message = safeErrorMessage(e);
        task(record.rawText, null, '[要確認] 判断または言い直しの反映に失敗');
        send('snapshot',snapshot()); send('error', { message });
        log({ type: 'error', operationId: item.operationId, message });
        return {};
    } finally {
        currentOperationId = null;
    }
}
const decisionStateKey = () => JSON.stringify([source, captionsSource, ctx, ui, lastAsk, lastCandidates, lastExecuted,
    undoStack.map(e => [e.id,e.op,e.target])]);
scheduler = createSttScheduler({ dispatch:processScheduled, stateKey:decisionStateKey, normalize,
    completeGate:() => displayGate.complete,
    partialPredicate:createP2PartialPredicate(() => ({source,context,state:localState({edit:JSON.parse(source),context,ctx,text:'',captions:parseCaptionList(captionsSource)})})),
    partialDelayMs:PARTIAL_MIN_MS, onSkip(reason,item) {
        if (/lite/.test(reason)) saved.skippedPartials++;
        log({ type:'schedule', operationId:item?.operationId, reason, revision:item?.revision });
    } });
const splitSentences = text => normalize(text).split(/(?<=[。？！?!])/).map(s=>s.trim()).filter(Boolean);
const withCarry = s => { if (carry && Date.now()-carry.at>CARRY_MS) carry=null; return carry ? `${carry.text} ${s}` : s; };
const isLocalPause = text => /^(?:止めて(?:ください)?|ストップ(?:して)?|停止(?:して)?|一時停止(?:して)?)(?:ね|よ)?[。．.!！?？]*$/.test(text);
const isSuffixOnly = text => {
    const plain = text.replace(/[\s。、．.!！?？]/g, '');
    return plain.length > 0 && plain.length <= 8 && /^(?:にして|して|で|を|に|へ|が|は|と|の|も|ね|よ|かな|か)$/.test(plain);
};
function onStt(rawText, final, sttT, suppliedId) {
    if (!listening) return null;
    const now = Date.now();
    let record = suppliedId ? utterances.get(String(suppliedId)) : activeOperation;
    if (record?.closed) return record.id;
    if (!record) {
        const id = suppliedId ? String(suppliedId) : `utterance-${utt++}`;
        record = { id, beforeCtx: structuredClone(ctx), beforeUi: structuredClone(ui), beforeCandidates: structuredClone(lastCandidates), beforeLastExecuted: structuredClone(lastExecuted), stateFingerprint:decisionStateKey() };
        utterances.set(id,record);
    }
    activeOperation = record; record.rawText = rawText;
    if (voice.firstTextAt == null) voice.firstTextAt = now;
    const lags = { voiceToText: voice.onsetAt == null ? null : voice.firstTextAt-voice.onsetAt,
        endToFinal: final && voice.lastVoiceAt != null ? now-voice.lastVoiceAt : null };
    log({ type: 'stt', utt: record.id, operationId: record.id, text: rawText, final, sttT, lags });
    send('stt', { utt: record.id, operationId: record.id, text: rawText, final, lags });
    const normalized = normalize(rawText);
    if (final && isLocalPause(normalized)) {
        record.closed = true; activeOperation = null; listenEpoch++; scheduler.reset();
        ui = { ...ui, playing:false, revision:ui.revision+1 };
        // 手元の文法で止めたときも実物のプレビューへ渡す（判断を通らないので ui の意図を送る係を通らない）
        void companionSenders()?.sendCommand('akari.preview.pause',{});
        range.tail = ''; range.chatLen = null; range.seekFiredFor = null; range.flyFiredFor = null; carry = null;
        log({ type:'local-stop', operationId:record.id, text:normalized });
        send('note', { utt:record.id, text:'ローカルで再生を停止' }); send('snapshot', snapshot());
        return record.id;
    }
    let itemText = withCarry(normalized);
    if (final && isSuffixOnly(normalized)) {
        if (itemText === normalized) {
            record.closed = true; activeOperation = null; range.tail = ''; range.chatLen = null;
            log({ type:'suffix-only', operationId:record.id, text:normalized, action:'record-only' });
            send('note', { utt:record.id, text:'語尾だけなので記録のみ' }); send('snapshot', snapshot());
            return record.id;
        }
        carry = null; record.rawText = itemText;
        log({ type:'suffix-rejoined', operationId:record.id, text:itemText });
    }
    if (final && lastFinalSeen && now-lastFinalSeen.at <= 1000 && lastFinalSeen.text === itemText
        && lastFinalSeen.stateFingerprint === record.stateFingerprint) {
        record.closed = true; activeOperation = null;
        log({ type:'discard', operationId:record.id, reason:'duplicate-final', text:itemText, stateFingerprint:record.stateFingerprint });
        send('note', { utt:record.id, text:'同じ確定結果を重複排除' }); return record.id;
    }
    if (final) lastFinalSeen = { text:itemText, at:now, stateFingerprint:record.stateFingerprint };
    const grammarState=final?localState({edit:JSON.parse(source),context,ctx:judgeCtx(),text:itemText,captions:parseCaptionList(captionsSource)}):null;
    const localGrammar=grammarState&&prepareLocalGrammarFinal({text:itemText,final,ctx:{...judgeCtx(),libraryTitles:COMPANION?libraryTitlesForGrammar():[],cutCount:grammarState.segments.length,duration:grammarState.segments.at(-1)?.end},segments:grammarState.segments,lastExecuted,operationId:record.id,stateFingerprint:decisionStateKey()});
    const item = { text:itemText, final, receivedAt: now, lags, operationId: record.id, epoch: listenEpoch, jevGeneration:localGrammar?.generation??localGrammarGeneration(record.id), ...(localGrammar?{localGrammar}:{}) };
    if (final) {
        record.closed = true; activeOperation = null;
        scheduler.final({ ...item, recognizerFinal: true });
        range.tail = ''; range.chatLen = null; voice.onsetAt = null; voice.firstTextAt = null;
    } else if (rawText !== range.tail) {
        range.tail = rawText; range.tailAt = now; range.tailJudged = null;
        if (!record.executedText) schedulePartial(item);
    }
    return record.id;
}
// 途中経過の判断を間引く: 初回は即時、以後 600ms・最新だけ。雑談中は 8 文字増えるまで呼ばない。
function schedulePartial(item) {
    if (range.chatLen != null && item.text.length < range.chatLen + CHAT_RECHECK_CHARS) { saved.skippedPartials++; return; }
    scheduler.partial(item);
}
function onLevel(rms) {
    if (!listening) return;
    const now = Date.now();
    // 騒音の床: 静かなときは素早く下げ、うるさいときはゆっくり上げる
    voice.floor = rms < voice.floor ? voice.floor * 0.9 + rms * 0.1 : Math.min(voice.floor * 1.01, 0.02);
    const speaking = rms > Math.max(0.012, voice.floor * 4);
    if (speaking) {
        if (!voice.active && (voice.lastVoiceAt == null || now - voice.lastVoiceAt > SILENCE_MS) && voice.onsetAt == null) { voice.onsetAt = now; log({ type: 'voice-onset' }); }
        voice.lastVoiceAt = now;
    }
    voice.active = speaking;
    // 黙って SILENCE_MS 経ち、言いかけの文字が残っているなら、音声認識の確定を待たずに判断へ回す
    if (!activeOperation?.executedText && !speaking && range.tail && range.tailJudged !== range.tail && voice.lastVoiceAt && now - voice.lastVoiceAt >= (range.needSilence ?? SILENCE_MS) && now - range.tailAt >= 300) {
        range.tailJudged = range.tail;
        scheduler.early({ text: withCarry(range.tail), final: true, early: true, operationId: activeOperation?.id, epoch: listenEpoch, receivedAt: now, jevGeneration:localGrammarGeneration(activeOperation?.id), lags: { earlyAfterSilence: now - voice.lastVoiceAt } });
    }
    send('level', { rms, speaking });
}

// ---- マイク
const supportedPlatform = process.platform === 'darwin' && Number(os.release().split('.')[0]) >= 25;
const executable = file => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } };
const bundledStt = [process.env.AKARI_VIBE_STT_BIN, path.join(ROOT, 'native/bin/akari-vibe-stt')].find(file => file && executable(file));
let micStatus = SERVE && (!supportedPlatform || (!bundledStt && !DEV)) ? 'unsupported' : USE_MIC && !FILE ? 'waiting' : 'off', inputStarted = false;
let inputFileEndedAt = null;
function productStatus() {
    return { platform: supportedPlatform ? 'ok' : 'unsupported', ...credentialStatus(),
        mic: micStatus === 'unsupported' ? 'unsupported' : micStatus === 'ready' ? 'ok'
            : /許可|denied/i.test(micStatus) ? 'denied' : 'unknown' };
}
function trackHelper(child) {
    helpers.add(child);
    child.once('close', () => helpers.delete(child));
    return child;
}
async function startInput() {
    if (inputStarted || (SERVE && micStatus === 'unsupported')) return;
    inputStarted = true; micStatus = 'starting'; send('mic', { status:micStatus }); send('snapshot', snapshot());
    let bin = bundledStt;
    if (!bin) {
        bin = path.join(os.tmpdir(), 'akari-voice-live-stt');
        const src = path.join(HERE, 'live-stt.swift');
        if (!fs.existsSync(bin) || !fs.existsSync(src) || fs.statSync(bin).mtimeMs < fs.statSync(src).mtimeMs) {
            console.log('音声認識ヘルパーをビルド中…');
            const args = ['-O', '-parse-as-library', '-swift-version', '5', src, '-o', bin,
                '-Xlinker', '-sectcreate', '-Xlinker', '__TEXT', '-Xlinker', '__info_plist', '-Xlinker', path.join(HERE, 'Info.plist')];
            const status = SERVE ? await new Promise(resolve => {
                const compiler = trackHelper(spawn('swiftc', args, { stdio: 'ignore' }));
                compiler.once('error', () => resolve(-1)); compiler.once('close', resolve);
            }) : spawnSync('swiftc', args, { encoding: 'utf8' }).status;
            if (status !== 0) { micStatus = SERVE ? 'unsupported' : 'build-failed'; inputStarted = false;
                send('mic', { status:micStatus }); send('snapshot', snapshot()); return; }
        }
    }
    if (stopping) return;
    const p = trackHelper(spawn(bin, FILE ? ['--file', path.resolve(FILE)] : [], { stdio: ['ignore', 'pipe', SERVE ? 'ignore' : 'inherit'] }));
    let buf = '';
    p.stdout.on('data', (chunk) => {
        buf += chunk; let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i); buf = buf.slice(i + 1);
            let m; try { m = JSON.parse(line); } catch { continue; }
            if (m.type === 'ready') { micStatus = 'ready'; console.log('マイク準備完了（ja-JP）'); send('mic', { status: micStatus }); }
            else if (m.type === 'status') {
                if (FILE && m.message === 'file-end' && inputFileEndedAt === null) {
                    inputFileEndedAt = Date.now();
                    log({ type:'input-file-end', inputFileEndedAt, sttT:m.t ?? null }); send('snapshot', snapshot());
                }
                console.log(m.message); send('mic', { status:m.message });
            } else if (m.type === 'error') {
                micStatus = `error: ${m.message}`; console.error('マイク: ' + m.message); send('mic', { status:micStatus });
            } else if (m.type === 'level') onLevel(m.rms);
            else if (m.type === 'stt') onStt(m.text, m.final, m.t);
        }
    });
    p.on('error', () => { micStatus = 'unsupported'; inputStarted = false; send('mic', { status:micStatus }); send('snapshot', snapshot()); });
    p.on('close', code => { inputStarted = false; log({type:'input-end',code});
        if (micStatus === 'ready') micStatus = `stopped (${code})`; send('mic', { status:micStatus }); });
    if (!SERVE) {
        process.once('exit', () => p.kill());
        process.once('SIGTERM', () => { p.kill(); process.exit(0); });
    }
}

if (FILE) await startInput();

// ---- HTTP
const body = (req) => new Promise((resolve,reject) => { let s = ''; req.on('data', d => { s += d; }); req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}); } catch (e) { reject(e); } }); req.on('error',reject); });
export async function handleHttpRequest(req, res) {
    const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    // 枠の中身は どの口にも `?k=` を付けて呼ぶ（自分が配られた鍵を持っている印）。
    // 問い合わせ文字列を落としてから突き合わせないと、全部 404 になる（2026-09-20 実機で観測）。
    const route = String(req.url ?? '').split('?')[0];
    if (SERVE && req.method === 'GET' && route === '/status') return json(productStatus());
    if (req.method === 'GET' && route === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(HERE, 'hud.html'))); }
    if (req.method === 'GET' && route === '/events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        clients.add(res); req.on('close', () => clients.delete(res));
        res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot())}\n\nevent: mic\ndata: ${JSON.stringify({ status: micStatus })}\n\n`);
        for (const h of history) res.write(`event: decision\ndata: ${JSON.stringify({ ...h, replay: true })}\n\n`);
        return;
    }
    if (req.method === 'GET' && route === '/snapshot') return json(snapshot());
    if (req.method !== 'POST') { res.writeHead(404); return res.end(); }
    let b; try { b = await body(req); } catch { res.writeHead(400); return res.end('Invalid JSON'); }
    if (SERVE && route === '/open-settings') {
        const result = await companionLink?.sendInstruction('command', { commandId:'akari.settings.open', args:{section:'connections'} });
        return json({ ok:result?.ok === true });
    }
    if (SERVE && route === '/open-privacy') {
        if (process.platform !== 'darwin') return json({ok:false});
        const child = trackHelper(spawn('open', ['x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'], {stdio:'ignore'}));
        const ok = await new Promise(resolve => { child.once('error', () => resolve(false)); child.once('close', code => resolve(code === 0)); });
        return json({ok});
    }
    if (route === '/say') { // テキスト入力。マイクと同じ経路（文分割・つなぎ）を通す
        const operationId = onStt(String(b.text ?? ''), b.final !== false, null, b.operationId);
        return json({ ok: listening, operationId });
    }
    if (route === '/listen') { if (typeof b.on !== 'boolean') return json({ ok:false }); setListening(b.on); return json({ ok: true, listening }); }
    if (route === '/settings') {
        if (!['on', 'off'].includes(b.earlySeek)) return json({ ok:false, error:'earlySeek は on/off' });
        earlySeek = b.earlySeek === 'on'; scheduler.reset(); range.seekFiredFor = null; range.flyFiredFor = null;
        log({ type:'settings', earlySeek }); send('snapshot', snapshot()); return json({ ok:true, earlySeek });
    }
    if (route === '/undo-entry' || route === '/ghost/undo') {
        try { const id = route === '/ghost/undo' ? ghosts.find(g=>g.id===b.id)?.editId : b.id; const ok = await undoEntry(id); send('snapshot',snapshot()); return json({ok}); }
        catch (e) { showBanner(e.message); send('snapshot',snapshot()); return json({ok:false,error:e.message}); }
    }
    if (route === '/ui') { ui = { ...ui, ...(typeof b.playing === 'boolean' ? {playing:b.playing} : {}), revision:ui.revision+1 }; send('snapshot',snapshot()); return json({ok:true}); }
    if (route === '/silence') { voice.lastVoiceAt = Date.now() - (b.ms ?? SILENCE_MS + 100); range.tailAt -= 400; onLevel(0); return json({ ok: true }); } // 検証用: 無音を再現する
    if (route === '/ctx') {
        ctx = { ...ctx, ...Object.fromEntries(Object.entries(b).filter(([key])=>['playheadT','selection','stroke','strokeCut','pointer','silent'].includes(key))) };
        if (b.stroke) { const st = localState({ edit: JSON.parse(source), context, ctx: { ...ctx, stroke: null }, text: '', captions: parseCaptionList(captionsSource) }); ctx.strokeCut = st.here + 1; }
        if (b.silent) { delete ctx.silent; return json({ ok: true }); }
        log({ type: 'ctx', ctx }); send('snapshot', snapshot()); return json({ ok: true });
    }
    if (route === '/label') {
        log({ type: 'label', utt: b.utt, ok: b.ok, note: b.note ?? null });
        const h = history.find((x) => x.utt === b.utt); if (h) h.label = { ok: b.ok, note: b.note ?? null };
        return json({ ok: true });
    }
    if (route === '/delete') { // 削除ボタン: 選択中のものを確認なしで消す（取り消しで戻せる）
        const edit = JSON.parse(source); const st = localState({ edit, context, ctx, text: '', captions: parseCaptionList(captionsSource) });
        const selected = Array.isArray(ctx.selection) ? ctx.selection : ctx.selection ? [ctx.selection] : [];
        const targets = selected.map(s=>s.replace(/[:\-]/g, '_'));
        const target = targets[0] ?? `cut_${st.here+1}`;
        try { const r = applyLive({ source, edit, ctx, segments: st.segments, context, captionsSource, persons: st.persons }, { op: 'delete', target, ...(targets.length>1 ? {targets} : {}), seek_to: 'none' }, ui); commit(r.source, { ...ctx, playheadT: r.playheadT, selection: null }, 'delete(button)', r.captionsSource, { op: 'delete', target }); }
        catch (e) { send('error', { message: e.message }); }
        send('snapshot', snapshot()); return json({ ok: true });
    }
    if (route === '/knob') {
        const operationId = `manual-${Date.now()}-${++utt}`, beforeOperationId = currentOperationId;
        try {
            utterances.set(operationId, { id:operationId, rawText:`${knobLabels[b.key] ?? b.key}を直接入力` });
            currentOperationId = operationId;
            const next = updateKnob(String(b.itemId ?? ''), String(b.key ?? ''), b.value);
            const nextCtx = { ...ctx, selection:String(b.itemId) };
            commit(next, nextCtx, `knob:${b.key}`, captionsSource, { op:'knob', target:String(b.itemId).replace(/[:\-]/g,'_') });
            log({ type:'manual-knob', operationId, itemId:b.itemId, key:b.key });
            send('snapshot',snapshot()); return json({ ok:true });
        } catch (e) {
            const message = safeErrorMessage(e); showBanner(message); send('snapshot',snapshot()); return json({ ok:false,error:message });
        } finally { currentOperationId = beforeOperationId; }
    }
    if (route === '/undo') { await undo(); send('snapshot', snapshot()); return json({ ok: true }); }
    if (route === '/redo') { await redo(); send('snapshot', snapshot()); return json({ ok: true }); }
    if (route === '/reset') {
        setListening(listening); ghosts=[]; tasks=[]; banner=null; lastChange=null; lastChangedItemId=null; lastCandidates=null;
        ui={playing:false,loop:null,timelineScale:1,revision:ui.revision+1}; lastAsk=null; lastExecuted=null;
        if(COMPANION&&projectTracker.state.ready){captionsSource=projectTracker.state.captionsSource;source=projectTracker.state.source;context=projectTracker.state.context;
            ctx={...freshCtx(),playheadT:projectTracker.state.playheadT,selection:projectTracker.state.selection};}
        else {captionsSource=initialCaptions;source=initialSource;ctx=freshCtx();}
        undoStack=[]; redoStack=[]; carry=null; lastFinalSeen=null;
        stats.calls=0; stats.cost=0; stats.inputTokens=0; stats.latencies.length=0;
        saved.skippedPartials=0; saved.liteCalls=0; saved.fullCalls=0; utteranceCosts.clear(); lastCostOperationId=null;
        log({ type:'cost-reset' });
        send('snapshot', snapshot()); return json({ ok: true });
    }
    res.writeHead(404); res.end();
}
if (!SERVE) http.createServer(handleHttpRequest).listen(PORT, '127.0.0.1', () => {
    console.log(`HUD: http://localhost:${PORT}   staleMs: ${STALE_MS}   earlySeek: ${earlySeek ? 'on' : 'off'}   記録: ${path.relative(process.cwd(), sessionFile)}   マイク: ${FILE ? `ファイル ${FILE}` : USE_MIC ? "ブラウザで『聞き取りを始める』を押す" : 'オフ（テキスト入力のみ）'}`);
});
if (COMPANION) {
    const token=SERVE ? serveToken : crypto.randomBytes(32).toString('hex');
    const started=await startCompanionServer({port:COMPANION_PORT,token,serve:SERVE,dev:DEV,hudHandler:handleHttpRequest,onState:state=>projectTracker.update(state),needsState:()=>!projectTracker.state.ready,onPulledState:state=>{
        // getState の戻りは snapshot（light の形に edit / captions が乗ったもの）なので、
        // docs として読み替えて渡す（2026-09-20 実機で観測: 係を上げ直すとシェルは
        // 「ハッシュが変わっていない」と見て docs を送らず、判断が永久に状態待ちになる）
        if(state?.edit?.text!==undefined&&state?.captions?.text!==undefined)
            projectTracker.update({type:'docs',seq:Number.isFinite(state.seq)?state.seq:Date.now(),
                projectSessionId:state.projectSessionId,edit:state.edit,captions:state.captions});
        else projectTracker.update(state);
    }});
    companionLink=started.link;
    if (SERVE) {
        productServer = started;
        if (stopping) { started.handler.close(); started.server.close(); }
        else process.stdout.write(JSON.stringify({type:'listening',port:started.server.address().port,protocol:0}) + '\n');
    } else {
        await writeCompanionConfig(COMPANION_PORT,token);
        console.log(`Companion: http://127.0.0.1:${COMPANION_PORT}`);
    }
}
