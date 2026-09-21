import { normalize } from '../src/text-normalize.mjs';

const BASE = Object.freeze({ is_command: 1, complete: 1, seek_to: 'none', place_item: 'none' });
const NUMBER = String.raw`(?:\d+(?:\.\d+)?|[零一二三四五六七八九十]+)`;
const ENDING = /(?:ね|よ|お願い|お願いします)$/;
const FILLER = /^(?:えーと|えっと|やっぱり|やっぱ|あの|その|まあ|んー|じゃあ|あ(?!と)|え|で)[、,]*/;

const OP_LABELS = Object.freeze({
    none: '編集なし', undo: '取り消し', redo: 'やり直し', repeat: 'もう一回',
    playback_relative_play: '再生', playback_relative_pause: '停止', playback_relative_seek: '再生位置',
    item_rotate: '回転', move_pos: '画面内の位置', scale: '拡大縮小', followup_replies_listen: '聞き取り',
});
const NONE_RISK = new Set(['none', 'playback_relative_play', 'playback_relative_pause', 'playback_relative_seek', 'followup_replies_listen']);

// src/judge/resolve.mjs の preparse のうち、この固定文法が参照する数値契約を
// import closure の外へ出さずに同じ順序・同じ丸めで移植する。
export function preparse(text) {
    const z2h = text.normalize('NFKC');
    const kanjiNumber = (value) => {
        if (!value) return null;
        if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value);
        const digits = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
        if (value === '十') return 10;
        const [tens, ones] = value.split('十');
        if (ones !== undefined) return (tens ? digits[tens] : 1) * 10 + (ones ? digits[ones] : 0);
        return digits[value] ?? null;
    };
    const numberSource = '\\d+(?:\\.\\d+)?|[零一二三四五六七八九十]+';
    const number = `(${numberSource})`;
    const lastNumber = (unit) => {
        const matches = [...z2h.matchAll(new RegExp(`${number}\\s*(?:${unit})(?:\\s*(?:くらい|ぐらい|ほど))?`, 'gi'))];
        return kanjiNumber(matches.at(-1)?.[1]);
    };
    const sec = z2h.match(/(\d+(?:\.\d+)?)\s*秒/);
    const min = z2h.match(/(\d+)\s*分(?!の)/);
    const seconds = sec || min ? (min ? Number(min[1]) * 60 : 0) + (sec ? Number(sec[1]) : 0) : null;
    const timesMatches = [
        ...z2h.matchAll(new RegExp(`${number}\\s*回\\s*(?:分|ぶん)`, 'gi')),
        ...z2h.matchAll(new RegExp(`あと\\s*${number}\\s*回(?!\\s*(?:分|ぶん))`, 'gi')),
    ].sort((a, b) => a.index - b.index);
    const timesValue = kanjiNumber(timesMatches.at(-1)?.[1]);
    const times = timesValue == null ? null : Math.max(1, Math.min(10, timesValue));
    const n = times == null ? z2h.match(new RegExp(`${number}\\s*回(?!\\s*(?:分|ぶん))`)) : null;
    const spoken = kanjiNumber(n?.[1]);
    const repeats = Math.max(...['やり直', '取り消', '戻して', 'もう一回', 'もう一度'].map((word) => z2h.split(word).length - 1));
    const relativeValues = [
        ...[...z2h.matchAll(/半分/g)].map((match) => ({ index: match.index, value: 0.5 })),
        ...[...z2h.matchAll(new RegExp(`${number}\\s*分の\\s*${number}`, 'gi'))].map((match) => ({
            index: match.index,
            value: kanjiNumber(match[2]) / kanjiNumber(match[1]),
        })),
        ...[...z2h.matchAll(new RegExp(`${number}\\s*倍(?:\\s*(?:くらい|ぐらい|ほど))?`, 'gi'))].map((match) => ({
            index: match.index,
            value: kanjiNumber(match[1]),
        })),
    ].filter(({ value }) => Number.isFinite(value)).sort((a, b) => a.index - b.index);
    const relative = relativeValues.at(-1) ?? null;
    return {
        seconds,
        count: Math.max(1, Math.min(10, spoken ?? repeats ?? 1)),
        times,
        pixels: lastNumber('px|ピクセル'),
        percent: lastNumber('%|パーセント'),
        degrees: lastNumber('度|°'),
        multiplier: relative?.value ?? null,
        multiplierRelative: relative ? true : null,
    };
}

export function surface(input) {
    let text = normalize(String(input ?? '')).normalize('NFKC').trim()
        .replace(/[。．、,！？!?]+$/g, '')
        .replace(/\s+/g, '');
    for (;;) {
        const next = text.replace(FILLER, '');
        if (next === text) break;
        text = next;
    }
    return text.replace(ENDING, '');
}

function decision(op, rule, args = {}) {
    return { ...BASE, op, ...args, rule };
}

function singleSelection(ctx) {
    const raw = ctx?.selection;
    if (typeof raw !== 'string' || !raw || raw.includes(',')) return null;
    const found = raw.match(/^(item|caption|cut):(.+)$/);
    if (!found || !found[2]) return null;
    return { kind: found[1], id: found[2], target: `${found[1]}_${found[2].replace(/[:\-]/g, '_').replace('#', '__')}` };
}

const GENERIC_SUBJECT = /^(?:これ|それ|この(?:素材|要素|もの)|選択中の(?:素材|要素|もの))(?:を|の)?/;

function subjectTail(text, selection) {
    const generic = text.match(GENERIC_SUBJECT)?.[0] ?? '';
    let tail = text.slice(generic.length);
    if (generic) return tail;
    if (new RegExp(`^(?:さらに|右|左|時計回り|反時計回り|${NUMBER}(?:px|ピクセル)|大きさ|サイズ|文字サイズ)`).test(text)) return text;

    const allowed = selection.kind === 'caption'
        ? ['字幕', 'テロップ', '文字']
        : selection.kind === 'cut'
            ? ['カット', '映像']
            : selection.id === 'logo'
                ? ['ロゴ', '素材', '要素']
                : selection.id === 'ov-chart'
                    ? ['グラフ', '図', '図解', '素材', '要素']
                    : /telop|lower-third/.test(selection.id)
                        ? ['テロップ', '字幕', '文字', '素材', '要素']
                        : /card/.test(selection.id)
                            ? ['カード', '素材', '要素']
                            : ['素材', '要素'];
    const name = allowed.flatMap((candidate) => [`選択中の${candidate}`, `この${candidate}`, candidate])
        .find((candidate) => text.startsWith(candidate));
    if (!name) return null;
    tail = text.slice(name.length).replace(/^(?:を|の)/, '');
    return tail;
}

function selectedMatch(text, ctx) {
    const selection = singleSelection(ctx);
    if (!selection) return null;
    const body = subjectTail(text, selection);
    if (body == null) return null;
    const parsed = preparse(text);

    let found = body.match(new RegExp(`^(?:(さらに))?(右|左|時計回り|反時計回り)?(?:に)?(${NUMBER})(?:度|°)(?:回転(?:して|する|してください|して下さい|してほしい|してもらえる|してもらえますか)?|回して|回してください|回して下さい)$`));
    if (found && selection.kind === 'item' && selection.id !== 'bgm' && parsed.degrees > 0) {
        const direction = found[2];
        return decision('item_rotate', 'selected.rotate.degrees', {
            target: selection.target,
            degrees: parsed.degrees,
            item_rotate_direction: /^(?:左|反時計回り)$/.test(direction ?? '') ? 'counterclockwise'
                : /^(?:右|時計回り)$/.test(direction ?? '') ? 'clockwise' : 'none',
        });
    }

    found = body.match(new RegExp(`^(${NUMBER})(?:px|ピクセル)(左上|右上|左下|右下|左|右|上|下)(?:に|へ)?(?:移動(?:して|する|してください|して下さい|してほしい|してもらえる|してもらえますか)?|動かして|ずらして|動かしてください|ずらしてください)$`, 'i'));
    if (found && selection.id !== 'bgm' && parsed.pixels > 0) {
        const directions = { 左: 'left', 右: 'right', 上: 'up', 下: 'down', 左上: 'top_left', 右上: 'top_right', 左下: 'bottom_left', 右下: 'bottom_right' };
        return decision('move_pos', 'selected.move.pixels', {
            target: selection.target,
            move_pos_kind: 'nudge',
            move_pos_direction: directions[found[2]],
            pixels: parsed.pixels,
        });
    }

    found = body.match(new RegExp(`^(?:大きさ|サイズ|文字サイズ)(?:を)?(${NUMBER})(?:%|パーセント)(?:の大きさ)?に(?:して|する|してください|して下さい|してほしい|してもらえる|してもらえますか)$`, 'i'));
    if (found && selection.id !== 'bgm' && parsed.percent > 0) {
        return decision('scale', 'selected.scale.percent', { target: selection.target, percent: parsed.percent });
    }

    found = body.match(new RegExp(`^(?:(?:大きさ|サイズ|文字サイズ)(?:を)?(${NUMBER}倍|半分|${NUMBER}分の${NUMBER})(?:くらい|ぐらい|ほど)?|(${NUMBER}倍|半分|${NUMBER}分の${NUMBER})(?:くらい|ぐらい|ほど)?(?:の)?(?:大きさ|サイズ|文字サイズ))(?:に)?(?:して|する|してください|して下さい|してほしい|してもらえる|してもらえますか)?$`));
    if (found && selection.id !== 'bgm' && Number.isFinite(parsed.multiplier) && parsed.multiplier > 0) {
        return decision('scale', 'selected.scale.multiplier', {
            target: selection.target,
            multiplier: parsed.multiplier,
            multiplierRelative: true,
        });
    }
    return null;
}

function cutCount(ctx) {
    if (Number.isSafeInteger(ctx?.cutCount)) return ctx.cutCount;
    if (Array.isArray(ctx?.cuts)) return ctx.cuts.length;
    return null;
}

function duration(ctx) {
    if (Number.isFinite(ctx?.duration)) return ctx.duration;
    if (Number.isFinite(ctx?.totalDuration)) return ctx.totalDuration;
    return null;
}

/** Match one finalized utterance against the frozen X5 grammar. */
export function match(input, ctx = {}) {
    const text = surface(input);
    if (!text) return null;
    const parsed = preparse(text);

    if (/^(?:(?:ここ|現在位置)から)?(?:再生|プレイ)(?:して|してください|して下さい|してほしい|してもらえる|してもらえますか)?$/.test(text)) {
        return decision('playback_relative_play', 'play.start');
    }
    if (/^(?:再生を)?(?:停止|一時停止|ストップ|止めて|止めてください|止めて下さい|止めてほしい|止めてもらえる|止めてもらえますか)$/.test(text)
        && !/止め絵|分割|聞き取り/.test(text)) {
        return decision('playback_relative_pause', 'play.pause');
    }

    // 素材の正式な名前をそのまま言った「入れて」は、名前が一意なら判断を呼ばずに入れる
    // （実機 2026-09-21: 「日本の緑黒板を入れて」の判断の確信が 0.64〜0.81 と線の前後で揺れ、入るかが運だった）。
    // 名前の一覧は手元の係が渡す（ctx.libraryTitles = [{id,title}]。無ければこの規則は当たらない）。
    {
        const named = text.match(/^(?:ライブラリ(?:の|から))?(.+?)を?(?:ここ(?:に|へ))?(?:入れて|追加して|置いて)(?:ください|下さい)?$/);
        const titles = Array.isArray(ctx.libraryTitles) ? ctx.libraryTitles : [];
        if (named && titles.length) {
            const squeeze = value => String(value ?? '').normalize('NFKC').replace(/[\s・]/g, '');
            const name = squeeze(named[1]);
            const hits = name.length >= 3 ? titles.filter(row => squeeze(row.title) === name) : [];
            if (hits.length === 1 && typeof hits[0].id === 'string') {
                return decision('insert_from_library_add', 'library.insert-by-title',
                    { w11_asset: hits[0].id, w11_reference: 'direct', w11_at: 'here' });
            }
        }
    }

    if (/^(?:ちょっと待って)?(?:聞き取りを止めて|聞き取りを停止|聞くのをやめて)$/.test(text) && ctx.listening !== false) {
        return decision('followup_replies_listen', 'mic.pause', { followup_listen_mode: 'pause' });
    }
    if (/^(?:もう聞いて(?:よい|いい)|聞き取りを再開(?:して|してください|して下さい)?)$/.test(text) && ctx.listening === false) {
        return decision('followup_replies_listen', 'mic.resume', { followup_listen_mode: 'resume' });
    }

    if (/^(?:もう一回|もう一度)$/.test(text) && (ctx.lastOp || (Array.isArray(ctx.history) && ctx.history.length))) {
        return decision('repeat', 'history.repeat');
    }
    const repeatTimes = /^もう.+回$/.test(text) ? parsed.count : parsed.times;
    if (/^(?:あと|もう).+回$|^.+回分$/.test(text) && repeatTimes != null) {
        const prior = Array.isArray(ctx.history) ? ctx.history[0] : null;
        if (prior && ['move_pos', 'scale', 'item_rotate'].includes(prior.op)) {
            return decision('repeat', 'history.repeat-times', { times: repeatTimes });
        }
    }

    if (/^やり直し(?:やり直し)*$/.test(text)) {
        if (ctx.canRedo === true) return decision('redo', 'history.redo', { count: parsed.count });
        if (ctx.canRedo === false && ctx.canUndo === true) return decision('undo', 'history.redo-as-undo', { count: parsed.count });
        return null;
    }
    if (/^(?:取り消し|取り消して|今の編集を?取り消して|今のなし|さっきの(?:編集|やつ)を?元に戻して)$/.test(text) && ctx.canUndo !== false) {
        return decision('undo', 'history.undo', { count: parsed.count });
    }
    if (new RegExp(`^${NUMBER}回(?:取り消し|取り消して)$`).test(text) && ctx.canUndo !== false) {
        return decision('undo', 'history.undo', { count: parsed.count });
    }
    if (/^(?:取り消しを(?:やめる|やめて|なしにする)|取り消しはなし)$/.test(text) && ctx.canRedo === true) {
        return decision('redo', 'history.redo', { count: parsed.count });
    }

    let found = text.match(new RegExp(`^(${NUMBER})秒(?:のところ)?(?:へ|に|まで)?(?:移動(?:して|する)?|行って?|飛んで?|開いて?|見せて?|戻って?)$`));
    if (!found) found = text.match(new RegExp(`^(?:(${NUMBER})分)?(${NUMBER})秒(?:のところ)?(?:へ|に|まで)?(?:移動(?:して|する)?|行って?|飛んで?|開いて?|見せて?|戻って?)$`));
    // 「N秒戻って」（場所の目印なし）は相対（N 秒ぶん戻る）。絶対時刻にするのは「N秒のところ／N秒に・へ・まで 戻って」だけ。
    if (found && /秒戻って?$/.test(text)) found = null;
    if (found && parsed.seconds != null && parsed.seconds >= 0 && (duration(ctx) == null || parsed.seconds <= duration(ctx))) {
        return decision('none', 'seek.absolute-time', { seek_to: 'time_spoken', seconds: parsed.seconds });
    }

    found = text.match(new RegExp(`^(?:カット(${NUMBER})|(${NUMBER})(?:番目|つ目)のカット)(?:へ|に|を)?(?:移動(?:して|する)?|行って?|飛んで?|開いて?|表示(?:して)?|見たい)$`));
    if (found) {
        const n = Number(found[1] ?? found[2]);
        const total = cutCount(ctx);
        if (Number.isSafeInteger(n) && n > 0 && total != null && n <= total) {
            return decision('none', 'seek.cut', { seek_to: `cut_${n}` });
        }
    }
    if (/^(?:最初|先頭|最初のカット)(?:へ|に)?(?:戻って?|移動(?:して|する)?|行って?|飛んで?|開いて?)$|^一番最初のところ$/.test(text)
        && (cutCount(ctx) ?? 1) >= 1) {
        return decision('none', 'seek.first', { seek_to: 'cut_1' });
    }
    if (/^(?:最後|最後のカット)(?:へ|に)?(?:移動(?:して|する)?|行って?|飛んで?|開いて?)$/.test(text)) {
        const total = cutCount(ctx);
        if (total != null && total > 0) return decision('none', 'seek.last', { seek_to: `cut_${total}` });
    }

    found = text.match(new RegExp(`^(${NUMBER})秒(?:戻って?|巻き戻して|前(?:に|へ)進めて)$`));
    if (found && parsed.seconds > 0 && Number.isFinite(ctx.playheadT)) {
        return decision('playback_relative_seek', 'seek.relative-back', {
            playback_relative_direction: 'backward', playback_relative_seconds: parsed.seconds,
        });
    }
    found = text.match(new RegExp(`^(${NUMBER})秒(?:先|後)(?:に|へ)?(?:進めて|動かして|早送り(?:して|する)?)$`));
    if (found && parsed.seconds > 0 && Number.isFinite(ctx.playheadT)) {
        return decision('playback_relative_seek', 'seek.relative-forward', {
            playback_relative_direction: 'forward', playback_relative_seconds: parsed.seconds,
        });
    }

    return selectedMatch(text, ctx);
}

function seekAt(decisionValue, segments, playheadT) {
    const n = decisionValue.seek_to?.match(/^cut_(\d+)$/)?.[1];
    const raw = decisionValue.seek_to === 'time_spoken' ? decisionValue.seconds
        : n ? segments?.find((segment) => segment.index + 1 === Number(n))?.at : null;
    if (!Number.isFinite(raw)) return null;
    const end = segments?.at(-1)?.end;
    return Number.isFinite(end) ? Math.max(0, Math.min(raw, Math.max(0, end - 0.01))) : raw ?? playheadT;
}

function responseIntents(decisionValue, { text, ctx, segments, lastExecuted }) {
    const intents = { navigate: null, select: null, execute: null, undoRedo: null, held: null, ask: null,
        taskOfferAnswer: null, split: null, carry: false };
    const fired = [];
    const at = decisionValue.seek_to !== 'none' ? seekAt(decisionValue, segments, ctx?.playheadT) : null;
    if (Number.isFinite(at)) {
        intents.navigate = { at };
        fired.push(`seek → ${at}秒（${decisionValue.seek_to}）`);
    }
    if (decisionValue.op === 'undo' || decisionValue.op === 'redo') {
        intents.undoRedo = { op: decisionValue.op, count: decisionValue.count ?? 1 };
    } else if (decisionValue.op === 'repeat') {
        const base = lastExecuted;
        if (!base) intents.held = { reason: 'くり返す操作がまだない' };
        else if (base.op === 'undo' || base.op === 'redo') {
            intents.undoRedo = { op: base.op, count: decisionValue.times ?? 1, repeat: true };
        } else {
            intents.execute = { op: base.op, target: base.target, targets: base.targets, base,
                d: { ...base, text, seek_to: 'none' }, count: decisionValue.times ?? 1, repeat: true,
                label: OP_LABELS[base.op] ?? base.op };
        }
    } else if (decisionValue.op !== 'none') {
        intents.execute = { op: decisionValue.op, target: decisionValue.target, targets: decisionValue.targets,
            base: decisionValue, d: { ...decisionValue, text }, count: 1, repeat: false,
            label: OP_LABELS[decisionValue.op] ?? decisionValue.op };
    }
    return { intents, fired };
}

export function createLocalGrammarResponse(decisionValue, options = {}) {
    const { text = '', ctx = {}, segments = [], lastExecuted = null, localGrammar = null } = options;
    const { intents, fired } = responseIntents(decisionValue, { text, ctx, segments, lastExecuted });
    const risk = NONE_RISK.has(decisionValue.op) ? 'none' : 'reversible';
    const target = decisionValue.target ?? 'none';
    const labels = { none: 'なし', [target]: target, [`op:${decisionValue.op}`]: OP_LABELS[decisionValue.op] ?? decisionValue.op };
    const direction = decisionValue.move_pos_direction ?? decisionValue.item_rotate_direction ?? 'none';
    const amount = [decisionValue.pixels, decisionValue.percent, decisionValue.degrees, decisionValue.multiplier].find(Number.isFinite) ?? 1;
    const lifecycleLastExecuted = intents.execute && decisionValue.op !== 'repeat' ? { ...decisionValue } : null;
    return {
        decision: decisionValue,
        conf: { seek_to: 1, target: 1, op: 1, gate: 1 },
        reject: null,
        missingArgs: [],
        usage: { input_tokens: 0, apiCalls: 0, cost: 0 },
        calls: 0,
        latencyMs: localGrammar?.matchMs ?? 0,
        intents,
        display: {
            labels,
            extra: { direction, color: 'none', amount, position: decisionValue.move_pos_direction ?? 'none' },
            probs: { seek_to: [[decisionValue.seek_to ?? 'none', 1]], op: [[decisionValue.op, 1]], target: [[target, 1]] },
            opLabel: OP_LABELS[decisionValue.op] ?? decisionValue.op,
        },
        lifecycle: { final: true, early: false, discarded: null, seekFiredFor: decisionValue.seek_to !== 'none' ? decisionValue.seek_to : null,
            clearAsk: true, lastExecuted: lifecycleLastExecuted, task: null },
        fired,
        events: [],
        risk,
        answers: {},
        state: undefined,
        decisionSource: 'local-grammar',
        grammarRule: decisionValue.rule,
        localGrammar,
    };
}

const generations = new Map();
const activeJev = new Map();

export function localGrammarGeneration(operationId) {
    return generations.get(operationId) ?? 0;
}

export function isCurrentJevGeneration(operationId, generation) {
    return generation === localGrammarGeneration(operationId);
}

export function registerJevRequest(operationId, generation = localGrammarGeneration(operationId)) {
    const controller = new AbortController();
    const entry = { generation, controller };
    if (!activeJev.has(operationId)) activeJev.set(operationId, new Set());
    activeJev.get(operationId).add(entry);
    return {
        generation,
        signal: controller.signal,
        release() {
            const entries = activeJev.get(operationId);
            entries?.delete(entry);
            if (!entries?.size) activeJev.delete(operationId);
        },
    };
}

export async function resolveLocalGrammarOrJev(item, { operationId, requestJev }) {
    let localPlan = item.localGrammar;
    const itemGeneration = item.jevGeneration ?? localGrammarGeneration(operationId);
    if (!localPlan && !isCurrentJevGeneration(operationId, itemGeneration)) {
        return { response: null, supersededGeneration: itemGeneration };
    }
    const request = localPlan ? null : registerJevRequest(operationId, itemGeneration);
    let response;
    let supersededGeneration = null;
    try {
        response = localPlan?.response ?? await requestJev(request.signal);
    } catch (error) {
        localPlan = item.promotedFinal?.localGrammar;
        if (localPlan) {
            supersededGeneration = request.generation;
            response = localPlan.response;
        } else if (!isCurrentJevGeneration(operationId, request.generation)) {
            return { response: null, supersededGeneration: request.generation };
        } else throw error;
    } finally {
        request?.release();
    }
    if (!localPlan && !isCurrentJevGeneration(operationId, request.generation)) {
        localPlan = item.promotedFinal?.localGrammar;
        supersededGeneration = request.generation;
        response = localPlan?.response ?? null;
    }
    return { response, supersededGeneration };
}

export function prepareLocalGrammarFinal({ text, final, ctx, segments, lastExecuted, operationId, stateFingerprint }) {
    if (final !== true) return null;
    const startedAt = Date.now();
    const decisionValue = match(text, ctx);
    if (!decisionValue) return null;
    const discardedJevGeneration = localGrammarGeneration(operationId);
    const generation = discardedJevGeneration + 1;
    generations.set(operationId, generation);
    for (const request of activeJev.get(operationId) ?? []) {
        if (request.generation < generation) request.controller.abort();
    }
    const matchMs = Date.now() - startedAt;
    const localGrammar = {
        decisionSource: 'local-grammar',
        grammarRule: decisionValue.rule,
        rawTextRef: `${operationId}:utterance.rawText`,
        normalizedTextRef: `${operationId}:decision.text`,
        stateFingerprint,
        matchMs,
        startedAt,
        generation,
        discardedJevGeneration,
    };
    return { generation, response: createLocalGrammarResponse(decisionValue, { text, ctx, segments, lastExecuted, localGrammar }) };
}

export function localGrammarAudit(response, applied) {
    const record = response?.localGrammar;
    if (!record) return {};
    return {
        decisionSource: 'local-grammar',
        grammarRule: record.grammarRule,
        rawTextRef: record.rawTextRef,
        normalizedTextRef: record.normalizedTextRef,
        stateFingerprint: record.stateFingerprint,
        applied: Boolean(applied),
        localGrammarElapsedMs: Math.max(0, Date.now() - record.startedAt),
        discardedJevGeneration: record.discardedJevGeneration,
    };
}

export default match;
