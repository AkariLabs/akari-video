"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAudioItemAudible = isAudioItemAudible;
exports.isCutAudioAudible = isCutAudioAudible;
exports.isLayerAudioAudible = isLayerAudioAudible;
/** Audibility belongs to the owning track and item, independently of its speech role. */
function isAudioItemAudible(track, item) {
    return track?.muted !== true && item?.mute !== true;
}
/** A detached cut keeps its pixels and timing but never supplies embedded audio. */
function isCutAudioAudible(cut, track) {
    return cut.audio !== false && isAudioItemAudible(track, cut);
}
/** Video layers own embedded speech even when their pixels are hidden or transformed. */
function isLayerAudioAudible(layer, track) {
    return layer.kind === 'video' && layer.isImage !== true
        && typeof layer.src === 'string' && layer.src.length > 0
        && !/\.(?:png|jpe?g|webp|bmp|gif|svg)(?:[?#].*)?$/iu.test(layer.src)
        && isCutAudioAudible(layer, track);
}
