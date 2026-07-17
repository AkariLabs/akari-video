import { CommandContribution } from '@theia/core/lib/common';
import { ContainerModule } from '@theia/core/shared/inversify';
import { OpenHandler, WidgetFactory } from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { AkariTranscriptContribution } from './akari-transcript-contribution';
import { AkariTranscriptSeekService } from './akari-transcript-seek-service';
import { AkariTranscriptWidget } from './akari-transcript-widget';

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
});
