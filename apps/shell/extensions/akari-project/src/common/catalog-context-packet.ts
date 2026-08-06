import { composeAgentContextPacket, collapseToSingleLine, AgentContextField } from './agent-context-packet';
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

const CATALOG_PACK_TARGET_KIND = 'カタログ素材パック';
const CATALOG_PACK_IMPORT_REQUEST =
    'このパックの未取得の無料素材をまとめて取得し、ライセンス表記を確認の上プロジェクトへ配置してください' +
    '（setup-library 系スキルの手順に従う）';

/** パック「まとめて取り込む」の列挙対象 1 件（CatalogItemMeta の必須 3 フィールドだけで足りる）。 */
export interface CatalogPackImportItem {
    id: string;
    category: string;
    title: string;
}

/**
 * パック棚ヘッダ「まとめて取り込む」= 未 installed の free 品目を列挙した定型パケット。
 * composeCatalogImportPrompt/composeCatalogAskAgentPrompt は composeAgentContextPacket の
 * 「対象 1 件 + 属性列挙」形（fields[0]=識別子）を前提にしており、複数品目の列挙には
 * 使い回せないためここで直接組み立てる。sendText 側の 1 行送信前提は変わらないため、
 * 結果は必ず collapseToSingleLine で 1 行に畳み込む。
 */
export function composeCatalogPackImportPrompt(packTitle: string, items: readonly CatalogPackImportItem[]): string {
    const list = items.map(item => `${item.id}（${item.category}・${item.title}）`).join('、');
    const summary = `${packTitle} — 対象 ${items.length} 件: ${list}`;
    return collapseToSingleLine(`【${CATALOG_PACK_TARGET_KIND}】${summary}について: ${CATALOG_PACK_IMPORT_REQUEST}`);
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
