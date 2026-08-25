"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TRANSITION_BY_ID = exports.TRANSITION_CATEGORIES = exports.TRANSITION_TYPE_IDS = exports.TRANSITION_VOCABULARY = void 0;
exports.isTransitionType = isTransitionType;
/**
 * edit.json の transition_out.type に使える正準語彙。
 * JSON Schema はリテラル enum を保つため別置きだが、drift test でこの表と一致させる。
 */
exports.TRANSITION_VOCABULARY = [
    { id: 'dissolve', xfadeName: 'dissolve', labelJa: 'ディゾルブ', category: 'フェード', previewKind: 'dissolve', glyph: 'D' },
    { id: 'fade', xfadeName: 'fade', labelJa: 'クロスフェード', category: 'フェード', previewKind: 'fade', glyph: 'F' },
    { id: 'fade-black', xfadeName: 'fadeblack', labelJa: '黒フェード', category: 'フェード', previewKind: 'fade-black', glyph: 'B' },
    { id: 'fade-white', xfadeName: 'fadewhite', labelJa: '白フェード', category: 'フェード', previewKind: 'fade-white', glyph: 'W' },
    { id: 'fade-grays', xfadeName: 'fadegrays', labelJa: 'モノクロフェード', category: 'フェード', previewKind: 'fade-grays', glyph: 'G' },
    { id: 'wipe-left', xfadeName: 'wipeleft', labelJa: 'ワイプ（左へ）', category: 'ワイプ', previewKind: 'wipe-left', glyph: '←' },
    { id: 'wipe-right', xfadeName: 'wiperight', labelJa: 'ワイプ（右へ）', category: 'ワイプ', previewKind: 'wipe-right', glyph: '→' },
    { id: 'wipe-up', xfadeName: 'wipeup', labelJa: 'ワイプ（上へ）', category: 'ワイプ', previewKind: 'wipe-up', glyph: '↑' },
    { id: 'wipe-down', xfadeName: 'wipedown', labelJa: 'ワイプ（下へ）', category: 'ワイプ', previewKind: 'wipe-down', glyph: '↓' },
    { id: 'radial', xfadeName: 'radial', labelJa: '時計ワイプ', category: 'ワイプ', previewKind: 'radial', glyph: '◷' },
    { id: 'slide-left', xfadeName: 'slideleft', labelJa: 'スライド（左へ）', category: 'スライド', previewKind: 'slide-left', glyph: '←' },
    { id: 'slide-right', xfadeName: 'slideright', labelJa: 'スライド（右へ）', category: 'スライド', previewKind: 'slide-right', glyph: '→' },
    { id: 'slide-up', xfadeName: 'slideup', labelJa: 'スライド（上へ）', category: 'スライド', previewKind: 'slide-up', glyph: '↑' },
    { id: 'slide-down', xfadeName: 'slidedown', labelJa: 'スライド（下へ）', category: 'スライド', previewKind: 'slide-down', glyph: '↓' },
    { id: 'cover-left', xfadeName: 'coverleft', labelJa: 'カバー（左へ）', category: 'カバー', previewKind: 'cover-left', glyph: '←' },
    { id: 'cover-right', xfadeName: 'coverright', labelJa: 'カバー（右へ）', category: 'カバー', previewKind: 'cover-right', glyph: '→' },
    { id: 'cover-up', xfadeName: 'coverup', labelJa: 'カバー（上へ）', category: 'カバー', previewKind: 'cover-up', glyph: '↑' },
    { id: 'cover-down', xfadeName: 'coverdown', labelJa: 'カバー（下へ）', category: 'カバー', previewKind: 'cover-down', glyph: '↓' },
    { id: 'reveal-left', xfadeName: 'revealleft', labelJa: 'リビール（左へ）', category: 'リビール', previewKind: 'reveal-left', glyph: '←' },
    { id: 'reveal-right', xfadeName: 'revealright', labelJa: 'リビール（右へ）', category: 'リビール', previewKind: 'reveal-right', glyph: '→' },
    { id: 'reveal-down', xfadeName: 'revealdown', labelJa: '上からリビール', category: 'リビール', previewKind: 'reveal-down', glyph: '↓' },
    { id: 'reveal-up', xfadeName: 'revealup', labelJa: '下からリビール', category: 'リビール', previewKind: 'reveal-up', glyph: '↑' },
    { id: 'circle-open', xfadeName: 'circleopen', labelJa: 'サークル（開く）', category: '形状', previewKind: 'circle-open', glyph: '○' },
    { id: 'circle-close', xfadeName: 'circleclose', labelJa: 'サークル（閉じる）', category: '形状', previewKind: 'circle-close', glyph: '●' },
    { id: 'zoom-in', xfadeName: 'zoomin', labelJa: 'ズームイン', category: '変形', previewKind: 'zoom-in', glyph: '＋' },
    { id: 'squeeze-h', xfadeName: 'squeezeh', labelJa: 'スクイーズ（縦つぶし）', category: '変形', previewKind: 'squeeze-h', glyph: '↕' },
    { id: 'squeeze-v', xfadeName: 'squeezev', labelJa: 'スクイーズ（横つぶし）', category: '変形', previewKind: 'squeeze-v', glyph: '↔' },
    { id: 'blur', xfadeName: 'hblur', labelJa: 'ブラー', category: '質感', previewKind: 'blur', glyph: 'B' },
    { id: 'pixelize', xfadeName: 'pixelize', labelJa: 'ピクセレート', category: '質感', previewKind: 'pixelize', glyph: 'P' }
];
exports.TRANSITION_TYPE_IDS = exports.TRANSITION_VOCABULARY.map(entry => entry.id);
exports.TRANSITION_CATEGORIES = [...new Set(exports.TRANSITION_VOCABULARY.map(entry => entry.category))];
exports.TRANSITION_BY_ID = Object.fromEntries(exports.TRANSITION_VOCABULARY.map(entry => [entry.id, entry]));
function isTransitionType(value) {
    return typeof value === 'string' && Object.prototype.hasOwnProperty.call(exports.TRANSITION_BY_ID, value);
}
