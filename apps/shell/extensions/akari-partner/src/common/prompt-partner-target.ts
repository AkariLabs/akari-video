export interface PromptPartnerTarget {
    id: string;
    form: 'terminal' | 'web' | 'extension';
    live: boolean;
}

export interface ForegroundWidget {
    id: string;
    parent?: ForegroundWidget | null;
}

export function promptPartnerAncestorId(
    foreground: ForegroundWidget | undefined, targets: readonly PromptPartnerTarget[]
): string | undefined {
    const visited = new Set<ForegroundWidget>();
    for (let widget = foreground; widget && !visited.has(widget); widget = widget.parent ?? undefined) {
        visited.add(widget);
        if (targets.some(target => target.id === widget.id && target.live)) return widget.id;
    }
    return undefined;
}

export function rememberPromptPartner(
    previousId: string | undefined, foreground: ForegroundWidget | undefined, targets: readonly PromptPartnerTarget[]
): string | undefined {
    return promptPartnerAncestorId(foreground, targets) ?? previousId;
}

export function choosePromptPartner(
    lastId: string | undefined, targets: readonly PromptPartnerTarget[]
): PromptPartnerTarget | undefined {
    const last = targets.find(target => target.id === lastId && target.live);
    if (last) return last;
    return targets.find(target => target.form === 'terminal' && target.live)
        ?? targets.find(target => target.form === 'web' && target.live)
        ?? targets.find(target => target.form === 'extension' && target.live);
}
