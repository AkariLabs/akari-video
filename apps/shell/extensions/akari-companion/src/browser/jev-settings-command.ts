import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { isJevSettingKey, JEV_SETTING_REAL_KEYS, validateSettingValue } from '../common/jev-settings-allowlist';

@injectable()
export class JevSettingsCommand implements CommandContribution {
    @inject(PreferenceService)
    protected readonly preferences!: PreferenceService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand({ id: 'akari.settings.setByVoice' }, {
            execute: async ({ key, value }: { key: string; value: unknown }) => {
                if (!isJevSettingKey(key)) throw new Error('許可されていない設定です');
                const validated = value === null ? null : validateSettingValue(key, value);
                if (validated && !validated.ok) throw new Error(validated.reason);
                const realKeys = JEV_SETTING_REAL_KEYS[key];
                const before = realKeys.map(realKey => this.preferences.inspect(realKey)?.globalValue ?? null);
                const next = validated?.ok ? validated.value : undefined;
                for (const realKey of realKeys) await this.preferences.set(realKey, next, PreferenceScope.User);
                const applied = this.preferences.inspect(realKeys[0])?.globalValue ?? null;
                return {
                    applied: { key, value: applied },
                    previous: { key, value: before[0] },
                    matched: true
                };
            }
        });
    }
}
