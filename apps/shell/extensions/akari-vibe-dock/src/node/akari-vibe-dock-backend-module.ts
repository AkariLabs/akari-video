import { ContainerModule } from '@theia/core/shared/inversify';
import { ConnectionContainerModule } from '@theia/core/lib/node/messaging/connection-container-module';
import { AkariEarClient, AkariEarService, AKARI_EAR_SERVICE_PATH } from '../common/ear-protocol';
import { AkariEarServiceImpl } from './ear-service';
import { AkariVoiceDictionaryService, AKARI_VOICE_DICTIONARY_SERVICE_PATH } from '../common/voice-dictionary-protocol';
import { AkariVoiceDictionaryServiceImpl } from './voice-dictionary-service';

export default new ContainerModule(bind => {
    bind(ConnectionContainerModule).toConstantValue(ConnectionContainerModule.create(({ bind: bindConnection, bindBackendService }) => {
        bindConnection(AkariEarServiceImpl).toDynamicValue(() => new AkariEarServiceImpl()).inSingletonScope();
        bindConnection(AkariEarService).toService(AkariEarServiceImpl);
        bindBackendService<AkariEarServiceImpl, AkariEarClient>(AKARI_EAR_SERVICE_PATH, AkariEarServiceImpl, (service, client) => {
            service.setClient(client);
            client.onDidCloseConnection(() => service.dispose());
            return service;
        });
        bindConnection(AkariVoiceDictionaryServiceImpl).toDynamicValue(() => new AkariVoiceDictionaryServiceImpl()).inSingletonScope();
        bindConnection(AkariVoiceDictionaryService).toService(AkariVoiceDictionaryServiceImpl);
        bindBackendService(AKARI_VOICE_DICTIONARY_SERVICE_PATH, AkariVoiceDictionaryServiceImpl);
    }));
});
