import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event } from '@theia/core/lib/common/event';
import { PreferenceService } from '@theia/core/lib/common/preferences';

@injectable()
export class AkariProjectModeService {
    protected readonly changeEmitter = new Emitter<boolean>();
    readonly onDidChange: Event<boolean> = this.changeEmitter.event;

    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

    @postConstruct()
    protected init(): void {
        this.preferences.onPreferenceChanged(change => {
            if (change.preferenceName === 'akari.developerMode') {
                this.changeEmitter.fire(this.developerMode);
            }
        });
    }

    get developerMode(): boolean {
        return this.preferences.get<boolean>('akari.developerMode', false);
    }
}
