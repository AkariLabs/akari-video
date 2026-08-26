import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';
import { injectable } from '@theia/core/shared/inversify';

export const AKARI_QUALITY_TIER = 'akari.qualityTier';
export const AKARI_DEVELOPER_MODE = 'akari.developerMode';
export const AKARI_CLOUD_ACCOUNT = 'akari.cloud.account';
// パートナー PTY（Claude Code 等）の応答完了 OS 通知（読む側: akari-partner の
// PartnerTurnNotifier — developerMode と同じく、スキーマはここが所有し読む側は文字列ミラー）。
export const AKARI_AGENT_TURN_END_NOTIFICATION = 'akari.notifications.agentTurnEnd';

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
        },
        [AKARI_AGENT_TURN_END_NOTIFICATION]: {
            type: 'boolean',
            default: true,
            description: 'AI パートナーの処理が終わったとき OS 通知を出す（ウィンドウが背面のときだけ）'
        }
    }
};

@injectable()
export class AkariPreferenceContribution implements PreferenceContribution {
    readonly schema = AKARI_PREFERENCE_SCHEMA;
}
