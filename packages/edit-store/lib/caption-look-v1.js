"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CAPTION_PIXEL_FIELDS = exports.CAPTION_DEFAULT_SIZE_PX = exports.CAPTION_RUN_LOOK_FIELDS = exports.CAPTION_ROW_LOOK_FIELDS = void 0;
exports.sanitizeMyStyleLook = sanitizeMyStyleLook;
exports.sanitizeCaptionRunLook = sanitizeCaptionRunLook;
exports.scaleCaptionLookPixels = scaleCaptionLookPixels;
exports.scaledLookForCaption = scaledLookForCaption;
exports.captionEffectiveSize = captionEffectiveSize;
exports.lookForCaptionAtSize = lookForCaptionAtSize;
exports.lookForCaptionRow = lookForCaptionRow;
exports.lookForCaptionRun = lookForCaptionRun;
const textstyle_catalog_1 = require("./generated/textstyle-catalog");
exports.CAPTION_ROW_LOOK_FIELDS = {
    color: true, size_px: true, reference_height_px: true, font_family: true,
    font_weight: true, weight: true, line_height: true, letter_spacing_em: true,
    text_transform: true, fill: true, strokes: true,
    stroke: ['color', 'width_px'], background: ['color', 'opacity', 'radius_px', 'padding_px', 'mode'],
    shadow: ['color', 'opacity', 'blur_px', 'distance_px', 'angle_deg'],
    glow: ['color', 'density', 'spread', 'offset_x', 'offset_y']
};
exports.CAPTION_RUN_LOOK_FIELDS = new Set([
    'color', 'font_weight', 'italic', 'underline', 'letter_spacing_em', 'scale',
    'baseline_shift_em', 'rotate_deg', 'stroke', 'shadow', 'glow', 'background'
]);
const RUN_LOOK_OMITTED_NAMES = {
    font_family: 'フォント', line_height: '行間', text_transform: '大文字・小文字の変換',
    fill: '塗り', strokes: '重ねた縁', size_px: '大きさ', reference_height_px: '基準の高さ'
};
exports.CAPTION_DEFAULT_SIZE_PX = 38;
exports.CAPTION_PIXEL_FIELDS = {
    stroke: ['width_px'], background: ['radius_px', 'padding_px'],
    shadow: ['blur_px', 'distance_px'], glow: ['spread', 'offset_x', 'offset_y'],
    strokes: ['width_px', 'offset_x', 'offset_y'], 'fill.pattern': ['scale']
};
function record(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function sanitizeMyStyleLook(value) {
    if (!record(value))
        return {};
    const look = {};
    for (const [key, allowed] of Object.entries(exports.CAPTION_ROW_LOOK_FIELDS)) {
        if (!(key in value))
            continue;
        const entry = value[key];
        if (allowed === true)
            look[key] = entry;
        else if (record(entry))
            look[key] = Object.fromEntries(Object.entries(entry).filter(([field]) => allowed.includes(field)));
    }
    return look;
}
function sanitizeCaptionRunLook(value) {
    if (!record(value))
        return { look: {}, omitted: [], notices: [] };
    const omitted = Object.keys(value).filter(key => key !== 'weight' && !exports.CAPTION_RUN_LOOK_FIELDS.has(key));
    const noticed = omitted.filter(key => key !== 'size_px' && key !== 'reference_height_px');
    const look = Object.fromEntries(Object.entries(value).filter(([key]) => exports.CAPTION_RUN_LOOK_FIELDS.has(key)));
    if (!Object.prototype.hasOwnProperty.call(look, 'font_weight') && Number.isInteger(value.weight)
        && value.weight >= 1 && value.weight <= 1000)
        look.font_weight = value.weight;
    return {
        look,
        omitted,
        notices: noticed.map(key => `${RUN_LOOK_OMITTED_NAMES[key] ?? 'この項目'}は字幕全体にだけ当てられます。`)
    };
}
/** 保存座標系で px 値だけを換算する。 */
function scaleCaptionLookPixels(look, targetSize) {
    const presetSize = look.size_px;
    const ratio = typeof presetSize === 'number' && Number.isFinite(presetSize) && presetSize > 0
        ? targetSize / presetSize : 1;
    const scaled = { ...look };
    for (const [key, fields] of Object.entries(exports.CAPTION_PIXEL_FIELDS)) {
        if (key === 'strokes' || key === 'fill.pattern')
            continue;
        const value = look[key];
        if (!record(value))
            continue;
        const copy = { ...value };
        for (const field of fields) {
            const current = copy[field];
            if (typeof current === 'number')
                copy[field] = current * ratio;
        }
        scaled[key] = copy;
    }
    if (Array.isArray(look.strokes))
        scaled.strokes = look.strokes.map(entry => {
            if (!record(entry))
                return entry;
            const stroke = { ...entry };
            for (const field of exports.CAPTION_PIXEL_FIELDS.strokes) {
                const current = stroke[field];
                if (typeof current === 'number')
                    stroke[field] = current * ratio;
            }
            return stroke;
        });
    if (record(look.fill) && look.fill.type === 'pattern' && record(look.fill.pattern)) {
        const pattern = { ...look.fill.pattern };
        if (typeof pattern.scale === 'number')
            pattern.scale *= ratio;
        scaled.fill = { ...look.fill, pattern };
    }
    return scaled;
}
/** 旧 API の返り値は size と基準高さを含まない。 */
function scaledLookForCaption(look, targetSize) {
    const scaled = scaleCaptionLookPixels(look, targetSize);
    delete scaled.size_px;
    delete scaled.reference_height_px;
    return scaled;
}
function captionEffectiveSize(row, defaultStyle, catalog = textstyle_catalog_1.TEXTSTYLE_CATALOG) {
    const before = record(row.text_style) ? row.text_style : {};
    const preset = typeof row.style_preset === 'string' ? catalog[row.style_preset]?.style : undefined;
    const presetStyle = record(preset) ? preset : {};
    const size = before.size_px ?? presetStyle.size_px ?? defaultStyle.size_px ?? exports.CAPTION_DEFAULT_SIZE_PX;
    return typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : exports.CAPTION_DEFAULT_SIZE_PX;
}
function lookForCaptionAtSize(look, targetSize, referenceHeight, scope = 'caption') {
    const scaled = scaleCaptionLookPixels(look, targetSize);
    if (scope === 'run') {
        const result = sanitizeCaptionRunLook(scaled);
        return { look: result.look, notices: result.notices };
    }
    scaled.size_px = targetSize;
    if (referenceHeight !== undefined)
        scaled.reference_height_px = referenceHeight;
    else
        delete scaled.reference_height_px;
    return { look: sanitizeMyStyleLook(scaled), notices: [] };
}
function lookForCaptionRow(row, defaultStyle, styleLook, options) {
    const before = record(row.text_style) ? row.text_style : {};
    const targetSize = captionEffectiveSize(row, defaultStyle, options.catalog);
    const source = sanitizeMyStyleLook(styleLook);
    const incoming = options.size === 'keep'
        ? lookForCaptionAtSize(source, targetSize, undefined).look : source;
    const textStyle = { ...before };
    for (const key of Object.keys(exports.CAPTION_ROW_LOOK_FIELDS))
        delete textStyle[key];
    Object.assign(textStyle, incoming);
    if (options.size === 'keep') {
        textStyle.size_px = targetSize;
        if (before.reference_height_px !== undefined)
            textStyle.reference_height_px = before.reference_height_px;
        if (before.layout !== undefined)
            textStyle.layout = before.layout;
    }
    else {
        if (before.layout !== undefined)
            textStyle.layout = before.layout;
        if (before.reference_height_px !== undefined && source.layout !== undefined) {
            textStyle.reference_height_px = before.reference_height_px;
        }
    }
    if (textStyle.layout !== undefined && textStyle.reference_height_px !== undefined) {
        return { notices: [], reason: 'layout と reference_height_px を同時に指定できません',
            reasonCode: 'AKARI_CAPTION_LAYOUT_REFERENCE_CONFLICT' };
    }
    return { text_style: textStyle, notices: [] };
}
function lookForCaptionRun(row, defaultStyle, styleLook, catalog) {
    return lookForCaptionAtSize(styleLook, captionEffectiveSize(row, defaultStyle, catalog), undefined, 'run');
}
