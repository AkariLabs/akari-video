import { editStore } from '../../src/edit-store.mjs';
import { itemForKey, view } from '../../src/v2/model.mjs';
import { roleKey } from '../../src/v2/telop.mjs';

const focus = (tabId, sectionId, fieldName) => Object.freeze({ tabId, sectionId, fieldName });
const visualKinds = Object.freeze(['cut', 'layer', 'overlay', 'item', 'telop']);
const legacyNeedsTargetIds = new Set(['delete','scale','move_time','color','move_pos','select','edit_text',
    'cut_look_opacity','caption_shift','trim_cut']);

// Each destination below is copied from the public inspector's real
// data-akari-field producer.  The source location is intentionally kept on
// every row so check-inspector-focus.mjs can verify the public vocabulary.
// Public source: apps/shell/extensions/akari-annotations/src/browser/akari-inspector-widget.ts
export const INSPECTOR_FOCUS_ROWS = Object.freeze([
    // transform-scale: widget.ts:639,865,1811,2026; caption-size: widget.ts:1125-1135
    { id:'scale-caption', operationId:'scale', targetKinds:['caption'], focus:focus('text','style','caption-size'), sourceLine:1125 },
    { id:'scale-visual', operationId:'scale', targetKinds:visualKinds, focus:focus('video','transform','transform-scale'), sourceLine:639 },

    // Time rows: widget.ts:666-667,901-902,1078-1084,1546-1547,1878-1879,2045-2046
    { id:'move-time-cut-layer', operationId:'move_time', targetKinds:['cut','layer','telop'], focus:focus('video','time','output-start'), sourceLine:666 },
    { id:'move-time-caption', operationId:'move_time', targetKinds:['caption'], focus:focus('text','timing','caption-start'), sourceLine:1237 },
    { id:'move-time-audio', operationId:'move_time', targetKinds:['audio'], focus:focus('audio','time','audio-start'), sourceLine:1546 },
    { id:'move-time-overlay', operationId:'move_time', targetKinds:['overlay'], focus:focus('video','time','overlay-start'), sourceLine:1878 },
    { id:'move-time-item', operationId:'move_time', targetKinds:['item'], focus:focus('video','time','item-start'), sourceLine:2045 },

    // Caption color is fixed (widget.ts:1117-1124). Native telop color is
    // resolved by the guarded telop-param-${name} rule at widget.ts:879-896.
    { id:'color-caption', operationId:'color', targetKinds:['caption'], focus:focus('text','style','caption-color'), sourceLine:1117 },

    // gain-db: widget.ts:708,1522; layer-gain-db: widget.ts:981
    { id:'volume-cut', operationId:'volume', targetKinds:['cut'], focus:focus('video','audio','gain-db'), sourceLine:708 },
    { id:'volume-layer', operationId:'volume', targetKinds:['layer'], focus:focus('video','audio','layer-gain-db'), sourceLine:981 },
    { id:'volume-audio', operationId:'volume', targetKinds:['audio'], focus:focus('audio','audio','gain-db'), sourceLine:1522 },
    // Retired v12 adapter audio_sfx_volume writes the same audio item gain_db.
    { id:'audio-sfx-volume', operationId:'audio_sfx_volume', targetKinds:['audio'], focus:focus('audio','audio','gain-db'), sourceLine:1522 },

    // Transform position: widget.ts:615-637,853-863,1799-1809,2012-2024;
    // caption-zone: widget.ts:1216-1230.
    { id:'move-pos-caption', operationId:'move_pos', targetKinds:['caption'], focus:focus('text','style','caption-zone'), sourceLine:1216 },
    { id:'move-pos-x', operationId:'move_pos', targetKinds:visualKinds, knobs:['x','left','right','top_left','top_right','bottom_left','bottom_right'], focus:focus('video','transform','transform-x'), sourceLine:615 },
    { id:'move-pos-y', operationId:'move_pos', targetKinds:visualKinds, knobs:['y','up','down'], focus:focus('video','transform','transform-y'), sourceLine:627 },
    { id:'move-pos-default', operationId:'move_pos', targetKinds:visualKinds, focus:focus('video','transform','transform-x'), sourceLine:615 },

    // caption-text: widget.ts:1092-1099. Native telop text uses the same
    // guarded dynamic telop-param rule as native telop color.
    { id:'edit-text-caption', operationId:'edit_text', targetKinds:['caption'], focus:focus('text','content','caption-text'), sourceLine:1092 },
    // Retired v12 adapter caption_shift writes caption start/end by the same delta.
    { id:'caption-shift', operationId:'caption_shift', targetKinds:['caption'], focus:focus('text','timing','caption-start'), sourceLine:1237 },

    // Audio rows: widget.ts:1387-1410,1558-1585,1596-1623.
    { id:'audio-duck', operationId:'audio_duck', targetKinds:['audio'], focus:focus('audio','audio:fades','audio-ducking'), sourceLine:1387 },
    { id:'audio-fade-in', operationId:'audio_fade', targetKinds:['audio'], knobs:['in'], focus:focus('audio','audio:fades','audio-fade-in'), sourceLine:1558 },
    { id:'audio-fade-out', operationId:'audio_fade', targetKinds:['audio'], knobs:['out'], focus:focus('audio','audio:fades','audio-fade-out'), sourceLine:1573 },
    { id:'audio-fade-default', operationId:'audio_fade', targetKinds:['audio'], focus:focus('audio','audio:fades','audio-fade-in'), sourceLine:1558 },
    { id:'audio-mute-cut', operationId:'audio_mute', targetKinds:['cut'], focus:focus('video','audio','mute'), sourceLine:722 },
    { id:'audio-mute-layer', operationId:'audio_mute', targetKinds:['layer'], focus:focus('video','audio','layer-audio'), sourceLine:973 },

    // Cut value rows: widget.ts:433-445,595-604.
    { id:'freeze-at', operationId:'cut_look_freeze', targetKinds:['cut'], knobs:['at','freeze-at'], focus:focus('video','freeze','freeze-at'), sourceLine:586 },
    { id:'freeze-duration', operationId:'cut_look_freeze', targetKinds:['cut'], focus:focus('video','freeze','freeze-duration'), sourceLine:595 },
    { id:'transition-duration', operationId:'cut_look_transition', targetKinds:['cut'], knobs:['duration','transition-duration'], focus:focus('video','time','transition-duration'), sourceLine:438 },
    { id:'transition-type', operationId:'cut_look_transition', targetKinds:['cut'], focus:focus('video','time','transition-type'), sourceLine:433 },
    { id:'transition-remove', operationId:'cut_look_transition_remove', targetKinds:['cut'], focus:focus('video','time','transition-type'), sourceLine:433 },

    // Appearance/duration rows: widget.ts:667,902,1547,1879,1894-1897,2046.
    { id:'item-blend', operationId:'item_blend', targetKinds:['layer','overlay','telop'], focus:focus('video','appearance','blend'), sourceLine:928 },
    { id:'duration-cut-layer', operationId:'item_duration', targetKinds:['cut','layer','telop'], focus:focus('video','time','duration'), sourceLine:667 },
    { id:'duration-audio', operationId:'item_duration', targetKinds:['audio'], focus:focus('audio','time','audio-duration'), sourceLine:1547 },
    { id:'duration-overlay', operationId:'item_duration', targetKinds:['overlay'], focus:focus('video','time','overlay-duration'), sourceLine:1879 },
    { id:'duration-item', operationId:'item_duration', targetKinds:['item'], focus:focus('video','time','item-duration'), sourceLine:2046 },
    // Retired trim_cut writes source.in/out and the cut duration; duration is
    // the only corresponding public inspector row (widget.ts:667).
    { id:'trim-cut-duration', operationId:'trim_cut', targetKinds:['cut'], focus:focus('video','time','duration'), sourceLine:667 },
    { id:'item-opacity', operationId:'item_opacity', targetKinds:visualKinds, focus:focus('video','appearance','opacity'), sourceLine:678 },
    // Retired v12 adapter cut_look_opacity writes item.opacity.
    { id:'cut-look-opacity', operationId:'cut_look_opacity', targetKinds:visualKinds, focus:focus('video','appearance','opacity'), sourceLine:678 },
    { id:'item-rotate', operationId:'item_rotate', targetKinds:visualKinds, focus:focus('video','transform','transform-rotate'), sourceLine:651 },

    // Adjust rows: widget.ts:2090-2116,2120-2132,2205-2216,2252-2264,2319-2327.
    { id:'brightness', operationId:'look_fx_brightness_brightness', targetKinds:['cut','layer','overlay','item'], focus:focus('adjust','adjust:basic','adjust-basic-exposure'), sourceLine:2090 },
    { id:'fx', operationId:'look_fx_brightness_fx', targetKinds:['cut','layer','overlay','item'], focus:focus('adjust','adjust:fx','adjust-fx-add'), sourceLine:2205 },
    { id:'look-lut', operationId:'look_fx_brightness_look', targetKinds:['cut','layer','overlay','item'], knobs:['lut'], focus:focus('adjust','adjust:lut','adjust-lut-preset'), sourceLine:2136 },
    { id:'look', operationId:'look_fx_brightness_look', targetKinds:['cut','layer','overlay','item'], focus:focus('adjust','adjust:basic','adjust-look'), sourceLine:2120 },

    // motion_keyframes writes these existing value fields, not the separate
    // motion-preset section: widget.ts:615-660,678-687.
    { id:'motion-scale', operationId:'motion_keyframes', targetKinds:visualKinds, knobs:['zoom_in','zoom_out'], focus:focus('video','transform','transform-scale'), sourceLine:639 },
    { id:'motion-opacity', operationId:'motion_keyframes', targetKinds:visualKinds, knobs:['fade_in','fade_out'], focus:focus('video','appearance','opacity'), sourceLine:678 },
    { id:'motion-y', operationId:'motion_keyframes', targetKinds:visualKinds, knobs:['up','down'], focus:focus('video','transform','transform-y'), sourceLine:627 },
    { id:'motion-x', operationId:'motion_keyframes', targetKinds:visualKinds, focus:focus('video','transform','transform-x'), sourceLine:615 },

    // Cut playback speed: widget.ts:693-700.
    { id:'speed', operationId:'speed', targetKinds:['cut'], focus:focus('video','timing','speed'), sourceLine:693 },
]);

// "Value operation" means an operation in src/ops that changes an existing
// item's field-like value (including a choice/text value), as opposed to
// insertion, deletion, selection, history, playback or shell navigation.
export const VALUE_OPERATION_IDS = Object.freeze([
    'scale', 'move_time', 'color', 'volume', 'move_pos', 'edit_text',
    'audio_duck', 'audio_fade', 'audio_mute', 'audio_sfx_volume', 'caption_emphasis', 'caption_shift',
    'cut_look_freeze', 'cut_look_transition', 'cut_look_transition_remove', 'cut_look_opacity',
    'declared_knobs', 'framing_person',
    'item_blend', 'item_duration', 'item_opacity', 'item_rotate',
    'look_fx_brightness_brightness', 'look_fx_brightness_fx', 'look_fx_brightness_look',
    'motion_keyframes', 'slip', 'speed', 'text_style_preset', 'trim_cut',
]);

export const RETIRED_VALUE_OPERATION_IDS = Object.freeze([
    'audio_sfx_volume', 'caption_shift', 'cut_look_opacity', 'trim_cut',
]);

// These operations have no stable row in the public inspector. They resolve
// to null, which means "open only". The list is also printed by the checker.
export const NULL_INSPECTOR_OPERATION_IDS = Object.freeze([
    // emphasis_words is stored in captions.json, but the inspector has no row for it.
    'caption_emphasis',
    // Public cut rows expose output time/duration/speed, not source in/out.
    'slip',
]);

export const NON_VALUE_OPERATION_GROUPS = Object.freeze({
    '編集なし': Object.freeze(['none']),
    '挿入・複製': Object.freeze([
        'add_text','captions','audio_bgm_pick','audio_sfx','insert_from_library_add','z_order_duplicate_copy',
    ]),
    '削除・構造編集': Object.freeze([
        'split','delete','reorder_cuts','reorder_cuts_swap','split_at_word','z_order_duplicate_zorder',
    ]),
    '選択': Object.freeze(['select','multi_select']),
    '履歴': Object.freeze([
        'undo','redo','repeat','selective_undo_checkpoint_restore','selective_undo_checkpoint_save','selective_undo_checkpoint_undo',
    ]),
    '再生・表示範囲': Object.freeze([
        'playback_relative_fit','playback_relative_loop','playback_relative_pause','playback_relative_play',
        'playback_relative_seek','playback_relative_zoom_in','playback_relative_zoom_out',
    ]),
    'シェル': Object.freeze(['followup_replies_listen','shell_ui_external','shell_ui_open']),
    '質問応答': Object.freeze(['answer_questions','followup_replies_answer','followup_replies_cancel']),
    '検索': Object.freeze(['insert_from_library_search']),
    '委譲・レビュー': Object.freeze(['silence_cut','emphasize','other','review_note','skill_dispatch']),
});
export const NON_VALUE_OPERATION_IDS = Object.freeze(Object.values(NON_VALUE_OPERATION_GROUPS).flat());

const dynamicOperationIds = new Set(['color','edit_text','declared_knobs','text_style_preset']);
export const MAPPED_INSPECTOR_OPERATION_IDS = Object.freeze([...new Set([
    ...INSPECTOR_FOCUS_ROWS.map(row => row.operationId), ...dynamicOperationIds,
    // framing_person writes x/y/scale; its target is a person key, so live only
    // reaches this row when the underlying cut has already been resolved.
    'framing_person',
])].filter(id => VALUE_OPERATION_IDS.includes(id) && !NULL_INSPECTOR_OPERATION_IDS.includes(id)).sort());

const sanitizeFieldPart = value => String(value).replace(/[^a-z0-9_-]+/giu, '-');
const hasOwn = (object, key) => object != null && Object.prototype.hasOwnProperty.call(object, key);

function nativeTelopFocus(target, role) {
    const key = target?.roleKeys?.[role];
    if (!/^[a-z0-9_-]+$/iu.test(key ?? '') || !hasOwn(target.params, key)) return null;
    // widget.ts:879-896 produces data-akari-field="telop-param-${name}" for
    // every primitive source.params entry that is actually present.
    return { tabId:'video', sectionId:'telop', fieldName:`telop-param-${key}` };
}

function declaredKnobFocus(target, touchedKnob) {
    if (target?.kind !== 'overlay' || typeof touchedKnob !== 'string' || !hasOwn(target.vars, touchedKnob)) return null;
    // widget.ts:1836-1866 produces data-akari-field="var-${sanitized name}".
    // The section id is dynamic (knob group order), so fieldName alone performs
    // the public widget's global query after opening the video tab.
    return { tabId:'video', fieldName:`var-${sanitizeFieldPart(touchedKnob)}` };
}

function touchedKnobOf(decision = {}) {
    switch (decision.op) {
        case 'move_pos': return decision.move_pos_direction ?? (decision.position !== 'none' ? decision.position : null);
        case 'audio_fade': return decision.audio_fade_dir;
        case 'cut_look_freeze': return decision.cutLookFreezeField;
        case 'cut_look_transition': return decision.cutLookTransitionSeconds == null ? 'type' : 'duration';
        case 'look_fx_brightness_look': return String(decision.w15_look_preset ?? '').startsWith('lut_') ? 'lut' : 'look';
        case 'motion_keyframes': return decision.motion_kind === 'enter' || decision.motion_kind === 'exit' || decision.motion_kind === 'pan'
            ? decision.motion_dir : decision.motion_kind;
        case 'declared_knobs': return decision.declared_knobs_knob;
        default: return null;
    }
}

export function inspectorFocusFor({ operationId, targetKind, target = null, missingArgs = [], touchedKnob = null, decision = {} } = {}) {
    if (!VALUE_OPERATION_IDS.includes(operationId) || NULL_INSPECTOR_OPERATION_IDS.includes(operationId)) return null;
    if (!targetKind || missingArgs.includes('target')) return null;
    const knob = touchedKnob ?? touchedKnobOf({ ...decision, op:operationId });

    if (operationId === 'color' && targetKind === 'telop') return nativeTelopFocus(target, 'color');
    if (operationId === 'edit_text' && targetKind === 'telop') return nativeTelopFocus(target, 'text');
    if (operationId === 'text_style_preset' && targetKind === 'telop') {
        const role = decision.w12_change === 'size' ? 'size'
            : decision.w12_change === 'background' ? 'background'
                : decision.w12_change === 'font' ? 'font' : decision.w12_change === 'stroke' ? 'stroke' : null;
        return role ? nativeTelopFocus(target, role) : null;
    }
    if (operationId === 'declared_knobs') return declaredKnobFocus(target, knob);
    if (operationId === 'framing_person') return ['cut','layer'].includes(targetKind)
        ? { tabId:'video', sectionId:'transform', fieldName:'transform-scale' } : null;

    const rows = INSPECTOR_FOCUS_ROWS.filter(row => row.operationId === operationId && row.targetKinds.includes(targetKind));
    const exact = rows.find(row => row.knobs?.includes(knob));
    const fallback = rows.find(row => !row.knobs);
    return exact?.focus ?? fallback?.focus ?? null;
}

function findItem(edit, target) {
    if (!edit || typeof target !== 'string') return null;
    if (target.startsWith('item_')) return itemForKey(edit, target);
    const cut = Number(target.match(/^cut_(\d+)$/u)?.[1]);
    if (cut) {
        const itemId=view(edit).segments.find(segment=>segment.index+1===cut)?.itemId;
        return itemId?editStore.locate(edit,itemId)?.item??null:null;
    }
    return null;
}

export function describeInspectorTarget(decision = {}, edit = null) {
    const targetKey = decision.target;
    if (typeof targetKey !== 'string' || ['none','unavailable'].includes(targetKey)) return null;
    if (targetKey.startsWith('caption_')) return { kind:'caption', targetKey };
    const item = findItem(edit, targetKey);
    if (!item) return null;
    const location = editStore.locate(edit, item.id);
    const inMainCut = targetKey.startsWith('cut_') || view(edit).segments.some(segment=>segment.itemId===item.id);
    const kind = inMainCut ? 'cut'
        : location?.track?.lane === 'audio' || item.role === 'bgm' ? 'audio'
            : item.source?.kind === 'telop' ? 'telop'
                : item.source?.kind === 'html' && decision.inspectorTargetKind === 'overlay' ? 'overlay'
                    : location?.parent ? 'item' : 'layer';
    const roleKeys = item.source?.kind === 'telop' ? {
        text:roleKey(item,'text'), color:roleKey(item,'color'), size:roleKey(item,'size'),
        stroke:roleKey(item,'stroke'), background:roleKey(item,'background'), font:roleKey(item,'font'),
    } : {};
    return { kind, targetKey, itemId:item.id, params:item.source?.params ?? {}, vars:item.source?.vars ?? {}, roleKeys };
}

export function editConfidenceOf(decision = {}, conf = {}) {
    // 操作の一覧（判断の中身）は手元の係に持ち込まない（決定 6・check-import-closure）。
    // 対象が要るかは、判断の返事に入っている門の項目（gateTerms）で分かる。
    const needsTarget=Array.isArray(conf.gateTerms)?conf.gateTerms.includes('target'):legacyNeedsTargetIds.has(decision.op);
    const terms=[conf.op,needsTarget?conf.target:1,Number.isFinite(conf.gate)?conf.gate:1];
    return terms.every(Number.isFinite)?Math.min(...terms):NaN;
}

export function shouldOpenInspector({ final, decision = {}, conf = {}, editGate = null, held = null,
    reject = null, missingArgs = [], executed = false } = {}) {
    if (!final || executed || !decision.op || ['none','select','shell_ui_open'].includes(decision.op)) return false;
    const missingValue = reject === 'missing_arg' && missingArgs.length > 0;
    const weakest=editConfidenceOf(decision,conf);
    // A destructive edit can be held at the response's edit gate even when
    // the judge does not label it low_confidence and reject is null.
    const heldBelowEditGate=Boolean(held)&&Number.isFinite(editGate)&&Number.isFinite(weakest)&&weakest<editGate;
    const heldForConfidence = reject === 'low_confidence' || heldBelowEditGate;
    return missingValue || heldForConfidence;
}

export function planInspectorFocus({ final, decision = {}, conf = {}, editGate = null, held = null,
    reject = null, missingArgs = [], executed = false,
    edit = null, selection = null, selectionAlreadySent = false, soloSupported = false } = {}) {
    if (!shouldOpenInspector({ final, decision, conf, editGate, held, reject, missingArgs, executed })) return null;
    let target=null;
    try{target=describeInspectorTarget(decision,edit);}catch{/* Invalid/unknown target falls back to opening only. */}
    if (!target || missingArgs.includes('target') || !selection) return { selection:null, selectionAlreadySent:false, openArgs:{} };
    const openArgs = inspectorFocusFor({ operationId:decision.op, targetKind:target.kind, target,
        missingArgs, decision });
    if (!openArgs) return { selection:null, selectionAlreadySent:false, openArgs:{} };
    return { selection, selectionAlreadySent:Boolean(selectionAlreadySent),
        openArgs:soloSupported===true&&openArgs.fieldName?{...openArgs,solo:true}:openArgs };
}

export function dispatchInspectorFocusPlan(plan, { sendSelect, sendInspectorOpen } = {}) {
    if (!plan) return false;
    if (plan.selection && !plan.selectionAlreadySent) sendSelect?.(plan.selection);
    sendInspectorOpen?.(plan.openArgs);
    return true;
}

// shell_ui_open currently resolves only shell_ui_target (panel_inspector), then
// clears the video target. It does not expose an operation/field answer, so a
// phrase such as "大きさのところ見せて" cannot safely enter this table yet.
// Do not infer a field name from the free-form utterance here.
