import { t } from '../common/shell-text';
import { PreferenceContribution, PreferenceSchema } from '@theia/core/lib/common/preferences';
import { OS } from '@theia/core/lib/common/os';
import { injectable } from '@theia/core/shared/inversify';
import { buildQuickExportEncoderChoices } from '../common/quick-export-cli';

export const AKARI_EXPORT_QUALITY = 'akari.export.quality';
export const AKARI_EXPORT_ENCODER = 'akari.export.encoder';
export const AKARI_EXPORT_CODEC = 'akari.export.codec';
export const AKARI_EXPORT_FPS = 'akari.export.fps';
export const AKARI_EXPORT_OUTPUT_DIRECTORY = 'akari.export.outputDirectory';
export const AKARI_EXPORT_GPU_PREFERENCE_CONSENT = 'akari.export.temporaryGpuPreference';

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
            description: t('shell.settings.exportPreferences.exportQualityChooseStandardHighQualityCompactMessage')
        },
        [AKARI_EXPORT_ENCODER]: {
            type: 'string',
            enum: encoderValues,
            default: 'auto',
            description: t('shell.settings.exportPreferences.exportEncoderAutoPrefersAvailableHardwareMessage')
        },
        [AKARI_EXPORT_CODEC]: {
            type: 'string',
            enum: ['h264', 'hevc', 'prores422', 'png'],
            default: 'h264',
            description: t('shell.settings.exportPreferences.exportFormatChooseH264H265HevcProres422Message')
        },
        [AKARI_EXPORT_FPS]: {
            type: 'number',
            enum: [24, 30, 60],
            description: t('shell.settings.exportPreferences.exportFrameRateUnsetUsesOutputSettingEditJsonMessage')
        },
        [AKARI_EXPORT_OUTPUT_DIRECTORY]: {
            type: 'string',
            default: '',
            description: t('shell.settings.exportPreferences.exportFolderUriLeaveBlankUseProjectSExportsFolderMessage')
        },
        [AKARI_EXPORT_GPU_PREFERENCE_CONSENT]: {
            type: 'boolean',
            description: t('shell.settings.exportPreferences.gpuPreferenceDescription')
        }
    }
};

@injectable()
export class AkariExportPreferenceContribution implements PreferenceContribution {
    readonly schema = AKARI_EXPORT_PREFERENCE_SCHEMA;
}
