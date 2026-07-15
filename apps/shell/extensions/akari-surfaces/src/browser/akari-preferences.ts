import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';
import { injectable } from '@theia/core/shared/inversify';

export const AKARI_QUALITY_TIER = 'akari.qualityTier';
export const AKARI_DEVELOPER_MODE = 'akari.developerMode';
export const AKARI_CLOUD_ACCOUNT = 'akari.cloud.account';

const AKARI_PREFERENCE_SCHEMA: PreferenceSchema = {
    properties: {
        [AKARI_QUALITY_TIER]: {
            type: 'string',
            enum: ['draft', 'final'],
            default: 'draft',
            description: 'AKARI Video の書き出し品質ティア'
        },
        [AKARI_DEVELOPER_MODE]: {
            type: 'boolean',
            default: false,
            description: '開発者向けのファイル表示とフル設定を有効にする'
        },
        [AKARI_CLOUD_ACCOUNT]: {
            type: 'string',
            default: '',
            description: 'AKARI Cloud アカウント'
        }
    }
};

@injectable()
export class AkariPreferenceContribution implements PreferenceContribution {
    readonly schema = AKARI_PREFERENCE_SCHEMA;
}
