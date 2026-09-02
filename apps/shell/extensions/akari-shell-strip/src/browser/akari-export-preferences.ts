import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';
import { OS } from '@theia/core/lib/common/os';
import { injectable } from '@theia/core/shared/inversify';
import { buildQuickExportEncoderChoices } from '../common/quick-export-cli';

export const AKARI_EXPORT_QUALITY = 'akari.export.quality';
export const AKARI_EXPORT_ENCODER = 'akari.export.encoder';
export const AKARI_EXPORT_CODEC = 'akari.export.codec';
export const AKARI_EXPORT_FPS = 'akari.export.fps';
export const AKARI_EXPORT_OUTPUT_DIRECTORY = 'akari.export.outputDirectory';

const platform = OS.type() === OS.Type.OSX
    ? 'darwin'
    : OS.type() === OS.Type.Windows ? 'win32' : 'linux';
const encoderValues = buildQuickExportEncoderChoices(platform).map(choice => choice.value);

const AKARI_EXPORT_PREFERENCE_SCHEMA: PreferenceSchema = {
    properties: {
        [AKARI_EXPORT_QUALITY]: {
            type: 'string',
            enum: ['standard', 'high', 'light', 'master'],
            default: 'standard',
            description: '書き出し画質。標準、高画質、軽量から選びます。'
        },
        [AKARI_EXPORT_ENCODER]: {
            type: 'string',
            enum: encoderValues,
            default: 'auto',
            description: '書き出しエンコーダ。自動では利用可能なハードウェアを優先します。'
        },
        [AKARI_EXPORT_CODEC]: {
            type: 'string',
            enum: ['h264', 'hevc'],
            default: 'h264',
            description: '書き出し映像コーデック。H.264 または H.265（HEVC）を選びます。'
        },
        [AKARI_EXPORT_FPS]: {
            type: 'number',
            enum: [24, 30, 60],
            description: '書き出しフレームレート。未設定では edit.json の出力設定に従います。'
        },
        [AKARI_EXPORT_OUTPUT_DIRECTORY]: {
            type: 'string',
            default: '',
            description: '書き出し先フォルダの URI。空欄ではプロジェクトの exports/ を使います。'
        }
    }
};

@injectable()
export class AkariExportPreferenceContribution implements PreferenceContribution {
    readonly schema = AKARI_EXPORT_PREFERENCE_SCHEMA;
}
