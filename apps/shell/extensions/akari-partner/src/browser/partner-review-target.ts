import { t } from '@akari-video/i18n';
import type { PartnerCatalogEntry } from './partner-catalog';

export interface PartnerReviewTarget {
    kind: 'terminal' | 'web' | 'extension' | 'chat';
    name: string;
}

export function partnerReviewTarget(widget: {
    id: string;
    kind?: string;
    agent?: string;
    caption?: string;
}, catalog: readonly PartnerCatalogEntry[]): PartnerReviewTarget | undefined {
    if (widget.id === 'akari-chat-widget') return { kind: 'chat', name: 'AKARI' };
    if (widget.kind === 'akari-partner') {
        const entry = catalog.find(candidate => candidate.form === 'cli' && candidate.agent === widget.agent);
        return { kind: 'terminal', name: entry?.name.replace(/ CLI$/, '') ?? widget.caption?.replace(/（.*$/, '') ?? t('partner.partnerReviewTarget.ui.partnerLabel') };
    }
    if (widget.id === 'akari-partner-web') return { kind: 'web', name: widget.caption || 'DeepSeek' };
    const entry = catalog.find(candidate => candidate.form === 'extension' &&
        candidate.viewContainerIds.some(id => widget.id === `plugin-view-container:${id}`));
    return entry ? { kind: 'extension', name: entry.name } : undefined;
}
