import type { AiTargetKind } from '../../common/ai-action-catalog';
import type { AiTabView } from './ai-tiles';

export function editCorrectionVisible(options: {
    aiView: AiTabView;
    targetKind: AiTargetKind;
    generationState?: string;
}): boolean {
    return options.aiView === 'tiles'
        && options.targetKind !== 'empty-frame'
        && options.targetKind !== 'empty-audio-frame'
        && !['planned', 'generating', 'stale', 'failed'].includes(options.generationState ?? '');
}
