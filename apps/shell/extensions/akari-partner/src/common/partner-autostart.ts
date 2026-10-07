import type { PartnerAgentId } from './akari-partner-protocol';
import type { PartnerCatalogEntry } from '../browser/partner-catalog';

export type AutoStartDecision = { action: 'start'; entry: PartnerCatalogEntry } | {
    action: 'skip'; reason: 'disabled' | 'no-workspace' | 'running' | 'closed-by-user' | 'no-history' | 'unknown-entry'
};

export function decideAutoStart(input: {
    enabled: boolean; hasWorkspace: boolean; alreadyRunning: boolean;
    projectLast?: { entryId: string | null }; markerAgent?: PartnerAgentId;
    catalog: PartnerCatalogEntry[];
}): AutoStartDecision {
    if (!input.enabled) return { action: 'skip', reason: 'disabled' };
    if (!input.hasWorkspace) return { action: 'skip', reason: 'no-workspace' };
    if (input.alreadyRunning) return { action: 'skip', reason: 'running' };
    if (input.projectLast?.entryId === null) return { action: 'skip', reason: 'closed-by-user' };
    if (input.projectLast) {
        const entry = input.catalog.find(candidate => candidate.id === input.projectLast?.entryId);
        return entry && entry.form !== 'extension' ? { action: 'start', entry } : { action: 'skip', reason: 'unknown-entry' };
    }
    if (!input.markerAgent) return { action: 'skip', reason: 'no-history' };
    const entry = input.catalog.find(candidate => candidate.agent === input.markerAgent && candidate.form === 'web')
        ?? input.catalog.find(candidate => candidate.agent === input.markerAgent && candidate.form === 'cli');
    return entry ? { action: 'start', entry } : { action: 'skip', reason: 'unknown-entry' };
}
