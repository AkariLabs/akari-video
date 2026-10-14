import { t } from '../common/project-text';
import { AssetSite } from './asset-sites';
import { composeAgentContextPacket } from './agent-context-packet';

export const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';
export function composeSiteAgentPrompt(site: AssetSite | undefined, request: string): string {
    // Same one-line context packet shape as composeCatalogImportPrompt, with site-only instructions.
    return composeAgentContextPacket(t('project.library.creator.site'), site ? [
        { value: site.id }, { label: 'tab', value: site.tab },
        { label: 'title', value: site.name }, { label: 'source:', value: site.entry_url }
    ] : [{ value: t('project.web.agentPrompt.searchAcrossSourcesAction') }],
    t('project.web.agentPrompt.userRequestSearchAKARILabLocalMessage', { value1: request.trim() }));
}
