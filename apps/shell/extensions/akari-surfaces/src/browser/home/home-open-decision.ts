export interface OpenDecisionInput {
    ask: boolean;
    busy: boolean;
    hasOrigin: boolean;
    reducedMotion: boolean;
}

export type OpenChoice = 'after-work' | 'here' | 'new-window';

export function decideOpenFlow(input: OpenDecisionInput): 'direct' | 'confirm' {
    return !input.ask && !input.busy ? 'direct' : 'confirm';
}

export function openChoices(busy: boolean): OpenChoice[] {
    return busy ? ['after-work', 'here', 'new-window'] : ['here', 'new-window'];
}

export function shouldAnimateOpen(input: Pick<OpenDecisionInput, 'hasOrigin' | 'reducedMotion'>): boolean {
    return input.hasOrigin && !input.reducedMotion;
}
