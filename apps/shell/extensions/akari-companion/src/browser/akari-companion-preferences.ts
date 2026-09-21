import { PreferenceContribution, PreferenceSchema, PreferenceScope } from '@theia/core/lib/common/preferences';
import { injectable } from '@theia/core/shared/inversify';

export const AKARI_COMPANION_ENABLED = 'akari.companion.enabled';

const AKARI_COMPANION_PREFERENCE_SCHEMA: PreferenceSchema = {
    properties: {
        [AKARI_COMPANION_ENABLED]: {
            type: 'boolean',
            default: true,
            // スキーマで利用者設定より広いスコープへの配置を防ぎ、読む側でも
            // 実効値ではなく globalValue だけを読むことで二重に守る。
            scope: PreferenceScope.User,
            description: '同じ機械で動く外部の操作盤（コンパニオン）とつなぐ'
        }
    }
};

@injectable()
export class AkariCompanionPreferenceContribution implements PreferenceContribution {
    readonly schema = AKARI_COMPANION_PREFERENCE_SCHEMA;
}
