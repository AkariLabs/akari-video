import type { DaihonCutCandidate, DaihonCutKind } from './daihon-cut-candidates';

export const DAIHON_CUT_KINDS: readonly DaihonCutKind[] = ['silence', 'filler', 'redo', 'unrecognized'];
export type DaihonCutSelection = Record<DaihonCutKind, boolean>;
export interface DaihonCutReview {
    step: 0 | 1 | 2;
    kinds: DaihonCutSelection;
    decisions: Record<string, boolean>;
    currentId?: string;
    applied: DaihonCutCandidate[];
}
export function initialDaihonCutReview(): DaihonCutReview {
    return { step: 0, kinds: { silence: true, filler: true, redo: false, unrecognized: true },
        decisions: {}, applied: [] };
}
export function reviewCandidates(state: DaihonCutReview, candidates: readonly DaihonCutCandidate[]): DaihonCutCandidate[] {
    return candidates.filter(candidate => state.kinds[candidate.kind]);
}
export function willCut(state: DaihonCutReview, candidate: DaihonCutCandidate): boolean {
    return state.decisions[candidate.id] ?? candidate.kind !== 'redo';
}
export function chosenCandidates(state: DaihonCutReview, candidates: readonly DaihonCutCandidate[]): DaihonCutCandidate[] {
    return reviewCandidates(state, candidates).filter(candidate => willCut(state, candidate));
}
export function setCutDecision(state: DaihonCutReview, id: string, cut: boolean): DaihonCutReview {
    return { ...state, decisions: { ...state.decisions, [id]: cut }, currentId: id };
}
export function setKindDecision(state: DaihonCutReview, candidates: readonly DaihonCutCandidate[],
    kind: DaihonCutKind | 'all', cut: boolean): DaihonCutReview {
    const decisions = { ...state.decisions };
    for (const candidate of reviewCandidates(state, candidates)) {
        if (kind === 'all' || candidate.kind === kind) decisions[candidate.id] = cut;
    }
    return { ...state, decisions };
}
export async function confirmDaihonCutReview(state: DaihonCutReview, candidates: readonly DaihonCutCandidate[],
    apply: (selected: DaihonCutCandidate[]) => Promise<boolean>): Promise<DaihonCutReview> {
    const selected = chosenCandidates(state, candidates);
    if (!selected.length || !(await apply(selected))) return state;
    return { ...state, step: 2, applied: selected };
}
