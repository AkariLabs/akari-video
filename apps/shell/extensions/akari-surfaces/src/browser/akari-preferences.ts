import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';
import { injectable } from '@theia/core/shared/inversify';

import { TRANSCRIBE_BACKENDS } from '../common/akari-connections-protocol';

export const AKARI_TRANSCRIBE_MODE = 'akari.transcribe.mode';
export const AKARI_TRANSCRIBE_BACKEND = 'akari.transcribe.backend';
export const AKARI_TRANSCRIBE_COMPARE_SET = 'akari.transcribe.compareSet';
export const AKARI_TRANSCRIBE_AUTO_CUTS = 'akari.transcribe.autoCuts';

export const AKARI_QUALITY_TIER = 'akari.qualityTier';
export const AKARI_TIMELINE_VISUAL_THUMBNAILS = 'akari.timeline.visualThumbnails';
// 読む側の文字列ミラー。スキーマは akari-project/src/browser/akari-project-frontend-module.ts が所有する。
export const AKARI_DEVELOPER_MODE = 'akari.developerMode';
// パートナー PTY（Claude Code 等）の応答完了 OS 通知（読む側: akari-partner の
// PartnerTurnNotifier — スキーマはここが所有し読む側は文字列ミラー）。
export const AKARI_AGENT_TURN_END_NOTIFICATION = 'akari.notifications.agentTurnEnd';

const AKARI_PREFERENCE_SCHEMA: PreferenceSchema = {
    properties: {
        [AKARI_TRANSCRIBE_MODE]: {
            type: 'string', enum: ['simple', 'advanced'], default: 'simple',
            description: '文字起こしのモード（簡単 / アドバンス）'
        },
        [AKARI_TRANSCRIBE_BACKEND]: {
            type: 'string', enum: ['auto', ...TRANSCRIBE_BACKENDS], default: 'auto',
            description: '文字起こしの既定エンジン（おまかせはローカルを優先）'
        },
        [AKARI_TRANSCRIBE_COMPARE_SET]: {
            type: 'array', items: { type: 'string', enum: [...TRANSCRIBE_BACKENDS] }, default: [], uniqueItems: true,
            description: '文字起こしを比べるときに使うエンジンの組（空なら比較しない）'
        },
        [AKARI_TRANSCRIBE_AUTO_CUTS]: {
            type: 'boolean', default: true,
            description: 'フィラー・言い直し・無音のカット候補を自動で作る（タイムラインには入れない）'
        },
        [AKARI_QUALITY_TIER]: {
            type: 'string',
            enum: ['draft', 'final'],
            default: 'draft',
            description: 'AKARI Video の書き出し品質ティア'
        },
        [AKARI_TIMELINE_VISUAL_THUMBNAILS]: {
            type: 'boolean', default: false,
            description: 'タイムラインに HTML / 3D 素材の絵を出す（オフのときは種別の色と名前だけ）'
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
