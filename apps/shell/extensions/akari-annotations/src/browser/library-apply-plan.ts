export type ApplyPayload = { kind: 'textanim' | 'textstyle' | 'mystyle' | 'font' | 'lut';
    id?: string; slot?: string; style?: unknown; fontFamily?: string };
export type ApplyTarget = { kind: 'caption' | 'cut' | 'layer' | 'item'; id: string };

type Part = { kind: string; text_style?: unknown; animation?: unknown };
export type ApplyPlan = { kind: 'caption'; id: string; parts: Part[] }
    | { kind: 'lut'; id: string; lut: string };

export function captionLibraryApplyFeedback(kind?: ApplyPayload['kind']): { history: string; footer: string } | undefined {
    if (kind === 'textanim') return { history: '動きを当てる', footer: '動きを当てました。' };
    if (kind === 'textstyle') return { history: 'スタイルを当てる', footer: 'スタイルを当てました。' };
    if (kind === 'font') return { history: 'フォントを変える', footer: 'フォントを変えました。' };
    return undefined;
}

export function timelineApplyTarget(payloadKind: string, chipKind?: string, chipId?: string,
    cutItemIds: readonly string[] = []): ApplyTarget | undefined {
    if (!chipId) return undefined;
    if (payloadKind === 'lut') {
        if (chipKind === 'layer') return { kind: 'layer', id: chipId };
        if (chipKind === 'cut') {
            const id = cutItemIds[Number(chipId)];
            return id ? { kind: 'cut', id } : undefined;
        }
        return undefined;
    }
    return payloadKind !== 'text' && chipKind === 'caption' ? { kind: 'caption', id: chipId } : undefined;
}

export function shouldShowTextPlaceBand(payloadKind?: string): boolean {
    return payloadKind === 'text' || payloadKind === 'textstyle' || payloadKind === 'mystyle';
}

/** The command consumes one plan in one history entry. Position is deliberately absent. */
export function planLibraryApply(payload: ApplyPayload, target?: ApplyTarget): ApplyPlan | undefined {
    if (!target?.id) return undefined;
    if (payload.kind === 'lut') return target.kind !== 'caption' && payload.id?.trim()
        ? { kind: 'lut', id: target.id, lut: payload.id } : undefined;
    if (target.kind !== 'caption') return undefined;
    if (payload.kind === 'textanim') {
        if (!payload.id?.trim()) return undefined;
        const slot = ['in', 'out', 'loop'].includes(payload.slot ?? '') ? payload.slot! : 'in';
        return { kind: 'caption', id: target.id,
            parts: [{ kind: 'motion', animation: { [slot]: { id: payload.id, duration_sec: 0.6 } } }] };
    }
    if (payload.kind === 'font') return payload.fontFamily?.trim()
        ? { kind: 'caption', id: target.id, parts: [{ kind: 'look', text_style: { font_family: payload.fontFamily.trim() } }] }
        : undefined;
    if (payload.kind === 'textstyle') return payload.style && typeof payload.style === 'object'
        ? { kind: 'caption', id: target.id, parts: [{ kind: 'look', text_style: payload.style }] } : undefined;
    const style = payload.style as { parts?: Part[] } | undefined;
    return Array.isArray(style?.parts) ? { kind: 'caption', id: target.id,
        parts: style.parts.filter(part => part && ['look', 'motion', 'sfx', 'fx', 'decor'].includes(part.kind)) } : undefined;
}
