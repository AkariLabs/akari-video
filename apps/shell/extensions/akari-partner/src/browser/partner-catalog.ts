import rawCatalog = require('../common/partner-catalog.json');
import { PartnerAgentId } from '../common/akari-partner-protocol';

export interface PlatformBinaryVerification {
    required: boolean;
    executableNames: string[];
    platformTokens: string[];
}

export interface PartnerCatalogEntry {
    id: string;
    extensionId: string;
    agent: PartnerAgentId;
    name: string;
    description: string;
    recommended: boolean;
    binaryVerification: Record<string, PlatformBinaryVerification>;
}

export const PARTNER_CATALOG = rawCatalog as PartnerCatalogEntry[];
