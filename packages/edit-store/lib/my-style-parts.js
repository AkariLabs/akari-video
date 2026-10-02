"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportedMyStyleAttachPart = supportedMyStyleAttachPart;
function supportedMyStyleAttachPart(part) {
    if (!['sfx', 'fx', 'decor'].includes(part.kind) || part.mode !== 'attach')
        return false;
    const value = part;
    const allowed = part.kind === 'sfx'
        ? ['kind', 'scope', 'mode', 'attach', 'asset', 'file', 'duration_sec', 'gain_db', 'in', 'out']
        : part.kind === 'decor'
            ? ['kind', 'scope', 'mode', 'attach', 'asset', 'file', 'vars', 'duration_sec']
            : ['kind', 'scope', 'mode', 'attach', 'effect', 'duration_sec'];
    if (Object.keys(value).some(key => !allowed.includes(key)))
        return false;
    const attach = value.attach;
    if (value.scope !== 'caption' || !isRecord(attach)
        || !['in', 'out', 'whole'].includes(String(attach.at))
        || !Number.isInteger(attach.offset_frames)
        || Object.keys(attach).some(key => !['at', 'offset_frames'].includes(key)))
        return false;
    if (part.kind === 'sfx' || part.kind === 'decor') {
        const asset = value.asset;
        const category = part.kind === 'sfx' ? 'audio' : 'overlay';
        if (!isRecord(asset) || asset.category !== category || typeof asset.id !== 'string'
            || !/^[A-Za-z0-9_-]+$/.test(asset.id) || typeof value.file !== 'string'
            || !/^[^/\\]+$/.test(value.file) || value.file === '.' || value.file === '..'
            || Object.keys(asset).some(key => !['category', 'id'].includes(key)))
            return false;
        if (part.kind === 'decor' ? !/\.html?$/i.test(value.file)
            : !/\.(wav|mp3|m4a|aac|flac|ogg|aif|aiff)$/i.test(value.file))
            return false;
    }
    if (part.kind === 'fx') {
        const effect = value.effect;
        if (!isRecord(effect) || !['invert', 'lut', 'saturation'].includes(String(effect.type)))
            return false;
        if (effect.type === 'invert' && Object.keys(effect).length !== 1)
            return false;
        if (effect.type === 'lut' && (typeof effect.id !== 'string' || !effect.id.trim()
            || Object.keys(effect).some(key => !['type', 'id', 'intensity'].includes(key))
            || (effect.intensity !== undefined && (typeof effect.intensity !== 'number'
                || effect.intensity < 0 || effect.intensity > 1))))
            return false;
        if (effect.type === 'saturation' && (typeof effect.value !== 'number'
            || effect.value < 0 || effect.value > 3 || Object.keys(effect).length !== 2))
            return false;
    }
    if (part.kind === 'sfx' && (typeof value.duration_sec !== 'number' || !Number.isFinite(value.duration_sec)
        || value.duration_sec <= 0 || (value.gain_db !== undefined
        && (typeof value.gain_db !== 'number' || value.gain_db < -60 || value.gain_db > 12))))
        return false;
    if (part.kind === 'sfx' && ((value.in !== undefined
        && (typeof value.in !== 'number' || !Number.isFinite(value.in) || value.in < 0))
        || (value.out !== undefined && (typeof value.out !== 'number' || !Number.isFinite(value.out)
            || value.out <= (typeof value.in === 'number' ? value.in : 0)))))
        return false;
    if (part.kind === 'decor' && value.vars !== undefined && !isRecord(value.vars))
        return false;
    if (part.kind !== 'sfx' && attach.at !== 'whole'
        && (typeof value.duration_sec !== 'number' || !Number.isFinite(value.duration_sec)
            || value.duration_sec <= 0))
        return false;
    return true;
}
function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
