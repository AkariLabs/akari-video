// The bulk caption shape keeps the global karaoke word style in display_policy.
import { setCaptionDisplayWordStyle } from '@akari-video/edit-store';
import { daihonDisplayPolicyForWrite, readDaihonDisplayKnobs } from './daihon-display-knobs';

export interface CaptionShape {
    chars: number;
    lines: 1 | 2;
    timing: 'full' | 'speech-tight';
}

type Row = Record<string, unknown>;
type Root = Record<string, unknown> & { captions?: Row[] };

function rows(root: unknown): Row[] {
    const value = Array.isArray(root) ? root : (root as Root | null)?.captions;
    return Array.isArray(value) ? value.filter((row): row is Row => !!row && typeof row === 'object' && !Array.isArray(row)) : [];
}

export function readCaptionShape(root: unknown): CaptionShape {
    const knobs = readDaihonDisplayKnobs(root);
    const timed = rows(root).filter(row => Array.isArray(row.words) && row.words.length > 0);
    return {
        chars: knobs.maxLineUnits,
        lines: knobs.lines >= 2 ? 2 : 1,
        timing: timed.length > 0 && timed.every(row => row.display_timing === 'speech-tight') ? 'speech-tight' : 'full'
    };
}

export function applyCaptionShape(root: unknown, shape: CaptionShape): Root {
    const base: Root = Array.isArray(root) ? { captions: root } : { ...((root && typeof root === 'object') ? root as Root : {}) };
    delete base.display_timing_default;
    const currentWordStyle = (base.display_policy as { word_style?: unknown } | undefined)?.word_style;
    const current = readDaihonDisplayKnobs(base);
    base.display_policy = daihonDisplayPolicyForWrite(base, {
        maxLineUnits: shape.chars, lines: shape.lines, wrap: current.wrap
    });
    if (currentWordStyle === 'none' || currentWordStyle === 'karaoke') {
        base.display_policy = setCaptionDisplayWordStyle(base, currentWordStyle).display_policy;
    }
    base.captions = rows(base).map(row => {
        const next = { ...row };
        if (Array.isArray(next.words) && next.words.length > 0) next.display_timing = shape.timing;
        return next;
    });
    return base;
}
