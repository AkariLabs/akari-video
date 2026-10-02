"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.replaceCaptionLine = replaceCaptionLine;
exports.decodeJsonString = decodeJsonString;
const caption_words_rederive_1 = require("./caption-words-rederive");
function replaceCaptionLine(source, captionId, text) {
    if (!captionId) {
        throw new Error('字幕の識別情報がありません。');
    }
    const lines = source.match(/.*(?:\r\n|\n|$)/g)?.filter(line => line.length > 0) ?? [];
    let matches = 0;
    const updated = lines.map(line => {
        const idMatch = line.match(/"id"\s*:\s*"((?:\\.|[^"\\])*)"/);
        if (!idMatch || decodeJsonString(idMatch[1]) !== captionId) {
            return line;
        }
        matches++;
        const openIndex = line.indexOf('{');
        const closeIndex = line.lastIndexOf('}');
        if (openIndex < 0 || closeIndex < openIndex) {
            throw new Error(`字幕 ${captionId} の1行形式を確認できません。`);
        }
        const record = JSON.parse(line.slice(openIndex, closeIndex + 1));
        const updated = (0, caption_words_rederive_1.applyCaptionTextEdit)(record, text).record;
        if (updated === record)
            return line;
        return line.slice(0, openIndex) + JSON.stringify(updated) + line.slice(closeIndex + 1);
    }).join('');
    if (matches !== 1) {
        throw new Error(matches === 0
            ? `字幕 ${captionId} が字幕データにありません。`
            : `字幕 ${captionId} が字幕データに複数あります。`);
    }
    return updated;
}
function decodeJsonString(value) {
    try {
        return JSON.parse(`"${value}"`);
    }
    catch {
        return value;
    }
}
