import rawCatalog = require('../common/partner-catalog.json');
import { PartnerAgentId } from '../common/akari-partner-protocol';

export interface PlatformBinaryVerification {
    required: boolean;
    executableNames: string[];
    platformTokens: string[];
}

interface PartnerCatalogEntryBase {
    id: string;
    agent: PartnerAgentId;
    name: string;
    description: string;
    recommended: boolean;
}

export interface PartnerCliCatalogEntry extends PartnerCatalogEntryBase {
    form: 'cli';
}

export interface PartnerExtensionCatalogEntry extends PartnerCatalogEntryBase {
    form: 'extension';
    extensionId: string;
    viewContainerIds: string[];
    binaryVerification: Record<string, PlatformBinaryVerification>;
}

export type PartnerCatalogEntry = PartnerCliCatalogEntry | PartnerExtensionCatalogEntry;

export const PARTNER_CATALOG = rawCatalog as PartnerCatalogEntry[];

export const PARTNER_CLI_ICON_CLASSES: Record<PartnerAgentId, string> = {
    claude: 'akari-partner-claude-cli-icon',
    codex: 'akari-partner-codex-cli-icon'
};
