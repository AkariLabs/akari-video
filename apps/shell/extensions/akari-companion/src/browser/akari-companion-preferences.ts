import { t } from '@akari-video/i18n';
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
            description: t('companion.companion.connectExternalControlPanelComputer.description')
        }
    }
};

@injectable()
export class AkariCompanionPreferenceContribution implements PreferenceContribution {
    readonly schema = AKARI_COMPANION_PREFERENCE_SCHEMA;
}
