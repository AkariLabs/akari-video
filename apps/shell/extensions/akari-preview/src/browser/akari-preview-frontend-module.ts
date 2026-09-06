import { CommandContribution } from '@theia/core/lib/common';
import { WidgetFactory } from '@theia/core/lib/browser';
import { AkariAudioMeterWidget } from './akari-audio-meter-widget';
import { AkariAudioMeterContribution } from './akari-audio-meter-contribution';
import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, OpenHandler, WebSocketConnectionProvider } from '@theia/core/lib/browser';
import { PreferenceContribution } from '@theia/core/lib/common/preferences';
import { FileResourceResolver } from '@theia/filesystem/lib/browser/file-resource';
import { AkariPreviewService, AKARI_PREVIEW_SERVICE_PATH } from '../common/akari-preview-protocol';
import { AkariAudioOpenHandler } from './akari-audio-open-handler';
import { AkariFileResourceResolver } from './akari-file-resource-resolver';
import { AkariImageOpenHandler } from './akari-image-open-handler';
import { AkariGpuPreferenceContribution } from './akari-gpu-preference-contribution';
import { AkariOutputPreviewOpenHandler, AkariPreviewOpenHandler } from './akari-preview-open-handler';

export default new ContainerModule((bind, _unbind, _isBound, rebind) => {
    bind(AkariAudioMeterWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AkariAudioMeterWidget.FACTORY_ID,
        createWidget: async () => context.container.get(AkariAudioMeterWidget)
    })).inSingletonScope();
    bind(AkariAudioMeterContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariAudioMeterContribution);

    rebind(FileResourceResolver).to(AkariFileResourceResolver).inSingletonScope();

    bind(AkariPreviewService).toDynamicValue(context =>
        WebSocketConnectionProvider.createProxy(context.container, AKARI_PREVIEW_SERVICE_PATH)
    ).inSingletonScope();

    bind(AkariPreviewOpenHandler).toSelf().inSingletonScope();
    bind(OpenHandler).toService(AkariPreviewOpenHandler);
    bind(AkariOutputPreviewOpenHandler).toSelf().inSingletonScope();
    bind(OpenHandler).toService(AkariOutputPreviewOpenHandler);
    bind(AkariAudioOpenHandler).toSelf().inSingletonScope();
    bind(OpenHandler).toService(AkariAudioOpenHandler);
    bind(AkariImageOpenHandler).toSelf().inSingletonScope();
    bind(OpenHandler).toService(AkariImageOpenHandler);
    bind(FrontendApplicationContribution).toService(AkariPreviewOpenHandler);
    bind(FrontendApplicationContribution).toService(AkariAudioOpenHandler);
    bind(AkariGpuPreferenceContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariGpuPreferenceContribution);
    bind(PreferenceContribution).toConstantValue({
        schema: {
            type: 'object',
            properties: {
                'akari.preview.frameEngine': {
                    type: 'boolean',
                    default: true,
                    description: 'frame-engine の製品プレビューを使います（false で従来の video プレビュー）。'
                },
                'akari.preview.highPerformanceGpu': {
                    type: 'boolean',
                    default: false,
                    description: 'プレビュー（デコード / 描画）を高性能 GPU で動かします。Windows のアプリ別 GPU 設定に書き込み、次回起動から有効。アプリ全体が高性能 GPU で動きます。'
                }
            }
        }
    });
});
