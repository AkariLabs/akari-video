export function captionFor(captions, target) {
    const matches = captions.filter(c => `caption_${c.id.replace(/[:-]/g, '_')}` === target);
    return matches.length === 1 ? matches[0] : null;
}
