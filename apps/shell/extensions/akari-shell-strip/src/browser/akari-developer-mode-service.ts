import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, Event, PreferenceService } from '@theia/core/lib/common';

const DEVELOPER_MODE_PREFERENCE = 'akari.developerMode';

/**
 * akari-shell-strip 内の F6/F7 が同じ developer mode 状態を購読するための薄い層。
 * スキーマは akari-project / akari-surfaces が所有するため、ここでは登録せず読むだけ。
 */
@injectable()
export class AkariDeveloperModeService {

    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

    protected enabled = false;
    protected readonly onDidChangeEmitter = new Emitter<boolean>();
    readonly onDidChange: Event<boolean> = this.onDidChangeEmitter.event;

    get isEnabled(): boolean {
        return this.enabled;
    }

    @postConstruct()
    protected init(): void {
        this.refresh();
        this.preferences.onPreferenceChanged(change => {
            if (change.preferenceName === DEVELOPER_MODE_PREFERENCE) {
                this.refresh();
            }
        });
        void this.preferences.ready.then(() => this.refresh());
    }

    protected refresh(): void {
        const next = this.preferences.get<boolean>(DEVELOPER_MODE_PREFERENCE, false);
        if (next === this.enabled) {
            return;
        }
        this.enabled = next;
        console.info('[akari-shell-strip] developer mode changed:', next);
        this.onDidChangeEmitter.fire(next);
    }
}
