import type { BoundaryBlock } from './transition-boundary-model';

export function transitionDeclarationIsDead(
    declared: boolean, blocks: readonly BoundaryBlock[], unsupported: boolean, placementDead: boolean
): boolean {
    return declared && (unsupported || placementDead || blocks.some(block => block !== 'locked'));
}

export function transitionWriteIsBlocked(next: unknown, blocks: readonly BoundaryBlock[]): boolean {
    return blocks.includes('locked') || (next !== null && blocks.length > 0);
}
