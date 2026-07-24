import { composeAgentContextPacket, AgentContextField } from './agent-context-packet';
import { CatalogItemMeta } from './catalog-reader';

/**
 * カタログカードの動詞 2 本（「取り込む」「頼む」）が組み立てる文脈パケット。
 * agent-context-packet.ts の汎用 composer を再利用し、カタログ固有の語彙
 * （id・category・title・source.url・license.spdx・when_to_use）だけをここに持つ。
 */

const CATALOG_TARGET_KIND = 'カタログ素材';

const CATALOG_IMPORT_REQUEST =
    'この素材をカタログの参照情報から取得し、ライセンス表記を確認の上プロジェクトへ配置してください' +
    '（setup-library 系スキルの手順に従う）';

/** 「取り込む」= 固定パケット。要素: id・category・title・source.url（あれば）・license.spdx（あれば）。 */
export function composeCatalogImportPrompt(item: CatalogItemMeta): string {
    return composeAgentContextPacket(CATALOG_TARGET_KIND, catalogDescriptorFields(item, false), CATALOG_IMPORT_REQUEST);
}

/** 「頼む」= 同要素 + when_to_use の先頭 1 文 + ユーザー入力文。 */
export function composeCatalogAskAgentPrompt(item: CatalogItemMeta, request: string): string {
    return composeAgentContextPacket(CATALOG_TARGET_KIND, catalogDescriptorFields(item, true), request);
}

function catalogDescriptorFields(item: CatalogItemMeta, includeWhenToUse: boolean): AgentContextField[] {
    const fields: AgentContextField[] = [
        { value: item.id },
        { label: 'category', value: item.category },
        { label: 'title', value: item.title }
    ];
    if (item.source?.url) {
        fields.push({ label: 'source:', value: item.source.url });
    }
    if (item.license?.spdx) {
        fields.push({ label: 'license:', value: item.license.spdx });
    }
    if (includeWhenToUse && item.when_to_use) {
        fields.push({ label: '用途:', value: firstSentence(item.when_to_use) });
    }
    return fields;
}

/**
 * meta.json の when_to_use は句点区切りの複数文のこともあれば、読点だけで
 * 続く句点なしの 1 文のこともある（実物差分を確認済み）。句点があれば
 * そこまでを、無ければ全文を「先頭 1 文」として返す。
 */
function firstSentence(text: string): string {
    const collapsed = text.replace(/\s+/g, ' ').trim();
    const match = collapsed.match(/^(.*?[。．.!?！？])/);
    return (match ? match[1] : collapsed).trim();
}
