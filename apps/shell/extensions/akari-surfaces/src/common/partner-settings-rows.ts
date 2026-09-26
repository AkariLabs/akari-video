import { PARTNER_AGENT_LABELS, PARTNER_CATALOG, PartnerCliCatalogEntry } from 'akari-partner/lib/browser/partner-catalog';

export function partnerSettingsCliRows(): Array<{ entry: PartnerCliCatalogEntry; name: string }> {
    return PARTNER_CATALOG.filter((entry): entry is PartnerCliCatalogEntry => entry.form === 'cli')
        .map(entry => ({ entry, name: PARTNER_AGENT_LABELS[entry.agent] }));
}
