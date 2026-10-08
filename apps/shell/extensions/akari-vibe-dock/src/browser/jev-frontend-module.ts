import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { interfaces } from '@theia/core/shared/inversify';
import { JevUtteranceRouter } from '../common/jev-utterance-router';
import { JevLocalRunner } from './jev-local-runner';

export function bindJev(bind: interfaces.Bind): void {
    bind(JevLocalRunner).toSelf().inSingletonScope();
    bind(JevUtteranceRouter).toService(JevLocalRunner);
    bind(FrontendApplicationContribution).toService(JevLocalRunner);
}
