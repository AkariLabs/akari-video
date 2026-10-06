import { CommandContribution } from '@theia/core/lib/common';
import { ContainerModule } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, OpenHandler, WidgetFactory } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { AkariTranscriptContribution } from './akari-transcript-contribution';
import { AkariTranscriptSeekService } from './akari-transcript-seek-service';
import { AkariTranscriptWidget } from './akari-transcript-widget';
import { AkariDaihonContribution } from './daihon/akari-daihon-contribution';
import { AkariDaihonWidget } from './daihon/akari-daihon-widget';

export default new ContainerModule(bind => {
    bind(AkariTranscriptSeekService).toSelf().inSingletonScope();

    bind(AkariTranscriptWidget).toSelf();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AkariTranscriptWidget.FACTORY_ID,
        createWidget: async (options: { analysisUri: string }) => {
            if (!options?.analysisUri) {
                throw new Error('文字起こしデータの場所がありません。');
            }
            const widget = context.container.get(AkariTranscriptWidget);
            await widget.configure(new URI(options.analysisUri));
            return widget;
        }
    })).inSingletonScope();

    bind(AkariTranscriptContribution).toSelf().inSingletonScope();
    bind(OpenHandler).toService(AkariTranscriptContribution);
    bind(CommandContribution).toService(AkariTranscriptContribution);

    bind(AkariDaihonWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(context => ({
        id: AkariDaihonWidget.FACTORY_ID,
        createWidget: () => context.container.get(AkariDaihonWidget)
    })).inSingletonScope();
    bind(AkariDaihonContribution).toSelf().inSingletonScope();
    bind(CommandContribution).toService(AkariDaihonContribution);
    bind(FrontendApplicationContribution).toService(AkariDaihonContribution);
});
