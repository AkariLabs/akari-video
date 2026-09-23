import { AssetSite } from './asset-sites';
import { composeAgentContextPacket } from './agent-context-packet';

export const PARTNER_INJECT_PROMPT_COMMAND_ID = 'akari.partner.injectPrompt';
export function composeSiteAgentPrompt(site: AssetSite | undefined, request: string): string {
    // Same one-line context packet shape as composeCatalogImportPrompt, with site-only instructions.
    return composeAgentContextPacket('素材サイト', site ? [
        { value: site.id }, { label: 'tab', value: site.tab },
        { label: 'title', value: site.name }, { label: 'source:', value: site.entry_url }
    ] : [{ value: '横断検索' }],
    `利用者の希望: ${request.trim()}。まず AKARI Lab と手持ちから探す。足りなければ素材サイトから選び、ページを開いてダウンロードの場所を光らせる。ダウンロードは利用者が押す。`);
}
