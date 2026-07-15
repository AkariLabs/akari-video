import { ContainerModule } from '@theia/core/shared/inversify';
import {
    FrontendApplicationContribution,
    ServiceConnectionProvider,
    WidgetFactory
} from '@theia/core/lib/browser';
import { AKARI_PARTNER_SERVICE_PATH, AkariPartnerServer } from '../common/akari-partner-protocol';
import { AkariPartnerContribution } from './akari-partner-contribution';
import { AkariPartnerWidget } from './akari-partner-widget';
import { AkariPartnerCatalogWidget } from './akari-partner-catalog-widget';
import { PartnerSessionService } from './partner-session-service';

export default new ContainerModule(bind => {
    bind(AkariPartnerServer).toDynamicValue(ctx =>
        ServiceConnectionProvider.createProxy(ctx.container, AKARI_PARTNER_SERVICE_PATH)
    ).inSingletonScope();

    bind(PartnerSessionService).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(PartnerSessionService);

    bind(AkariPartnerWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: AkariPartnerWidget.ID,
        createWidget: () => ctx.container.get(AkariPartnerWidget)
    })).inSingletonScope();

    bind(AkariPartnerCatalogWidget).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: AkariPartnerCatalogWidget.FACTORY_ID,
        createWidget: () => ctx.container.get(AkariPartnerCatalogWidget)
    })).inSingletonScope();

    bind(AkariPartnerContribution).toSelf().inSingletonScope();
    bind(FrontendApplicationContribution).toService(AkariPartnerContribution);
});
