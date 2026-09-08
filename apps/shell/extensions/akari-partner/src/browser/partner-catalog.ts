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
    /**
     * 選ぶ前に読ませたい注意書き（任意）。ピッカーはこのフィールドの有無だけで
     * 表示を決める — `form` からの導出はしない（task/2026-09-08-partner-form-caution
     * 指示1: 将来 form が増えてもデータ側の宣言だけで済むようにする）。
     */
    caution?: string;
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

export const PARTNER_AGENT_LABELS: Record<PartnerAgentId, string> = {
    claude: 'Claude Code',
    codex: 'Codex (OpenAI)',
    opencode: 'opencode',
    commandcode: 'Command Code',
    copilot: 'GitHub Copilot',
    cursor: 'Cursor',
    antigravity: 'Antigravity (Google)',
    grok: 'Grok Build (xAI)'
};

export const PARTNER_CLI_ICON_CLASSES: Record<PartnerAgentId, string> = {
    claude: 'akari-partner-claude-cli-icon',
    codex: 'akari-partner-codex-cli-icon',
    opencode: 'akari-partner-opencode-cli-icon',
    commandcode: 'akari-partner-commandcode-cli-icon',
    copilot: 'akari-partner-copilot-cli-icon',
    cursor: 'akari-partner-cursor-cli-icon',
    antigravity: 'akari-partner-antigravity-cli-icon',
    grok: 'akari-partner-grok-cli-icon'
};
