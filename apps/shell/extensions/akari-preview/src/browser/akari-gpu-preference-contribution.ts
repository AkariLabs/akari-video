import { t } from '../common/preview-text';
import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MessageService } from '@theia/core/lib/common';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { AkariPreviewService } from '../common/akari-preview-protocol';

export const HIGH_PERFORMANCE_GPU_PREFERENCE_ID = 'akari.preview.highPerformanceGpu';

@injectable()
export class AkariGpuPreferenceContribution implements FrontendApplicationContribution {
    @inject(AkariPreviewService) protected readonly service: AkariPreviewService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;

    onStart(): void {
        void this.reconcile().catch(error => this.warnRpcFailure(error));
        this.preferences.onPreferenceChanged(event => {
            if (event.preferenceName === HIGH_PERFORMANCE_GPU_PREFERENCE_ID) {
                // Theia の PreferenceChange は newValue を公開しないため、変更後の実効値を取得する。
                const newValue = 'newValue' in event ? event.newValue
                    : this.preferences.get<boolean>(HIGH_PERFORMANCE_GPU_PREFERENCE_ID, false);
                void this.apply(Boolean(newValue)).catch(error => this.warnRpcFailure(error));
            }
        });
    }

    protected async reconcile(): Promise<void> {
        const enabled = this.preferences.get<boolean>(HIGH_PERFORMANCE_GPU_PREFERENCE_ID, false);
        if (enabled !== true) return;
        const state = await this.service.getGpuPreferenceState();
        if (state.supported !== true || state.current === 'high-performance') return;
        if (state.current === 'other') {
            void this.messages.warn(t('preview.gpuSettings.notification.highPerformanceGpuSettingNotChangedBecauseWindows'));
            return;
        }
        if (state.current === 'unset' || state.current === 'power-saving') {
            const result = await this.service.setHighPerformanceGpu(true);
            if (result.ok === false) this.warnReason(result.reason);
        }
    }

    protected async apply(enabled: boolean): Promise<void> {
        const result = await this.service.setHighPerformanceGpu(enabled);
        if (result.ok === false) {
            this.warnReason(result.reason);
        } else if (enabled) {
            void this.messages.info(t('preview.gpuSettings.notification.highPerformanceGpuEnabledChangeTakesEffectRestarting'));
        } else {
            void this.messages.info(t('preview.gpuSettings.notification.highPerformanceGpuSettingRestoredChangeTakesEffect'));
        }
    }

    protected warnReason(reason: string): void {
        if (reason.startsWith('unsupported')) {
            void this.messages.warn(t('preview.gpuSettings.notification.gpuAssignmentCannotChangedEnvironmentError'));
        } else if (reason.startsWith('user-preference')) {
            void this.messages.warn(t('preview.gpuSettings.notification.gpuSettingNotChangedBecauseWindowsUserSelected'));
        } else {
            void this.messages.warn(t('preview.gpuSettings.notification.couldNotChangeHighPerformanceGpuSettingError', { reason }));
        }
    }

    protected warnRpcFailure(error: unknown): void {
        this.warnReason(error instanceof Error ? error.message : String(error));
    }
}
