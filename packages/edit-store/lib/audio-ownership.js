"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAudioItemAudible = isAudioItemAudible;
exports.isCutAudioAudible = isCutAudioAudible;
/** Audibility belongs to the owning track and item, independently of its speech role. */
function isAudioItemAudible(track, item) {
    return track?.muted !== true && item?.mute !== true;
}
/** A detached cut keeps its pixels and timing but never supplies embedded audio. */
function isCutAudioAudible(cut, track) {
    return cut.audio !== false && isAudioItemAudible(track, cut);
}
