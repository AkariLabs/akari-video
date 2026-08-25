import * as React from '@theia/core/shared/react';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import {
    AKARI_AGENT_TURN_END_NOTIFICATION,
    AKARI_CLOUD_ACCOUNT,
    AKARI_DEVELOPER_MODE,
    AKARI_QUALITY_TIER
} from './akari-preferences';

@injectable()
export class AkariSettingsWidget extends ReactWidget {
    static readonly ID = 'akari-settings-widget';

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    protected qualityTier = 'draft';
    protected theme = 'dark';
    protected developerMode = false;
    protected agentTurnEndNotification = true;
    protected cloudAccount = '';
    protected saveMessage = '';

    @postConstruct()
    protected init(): void {
        this.id = AkariSettingsWidget.ID;
        this.title.label = '設定';
        this.title.caption = 'AKARI 設定';
        this.title.iconClass = 'codicon codicon-settings-gear';
        this.title.closable = false;
        this.refreshValues();
        this.toDispose.push(this.preferences.onPreferenceChanged(change => {
            if ([
                AKARI_QUALITY_TIER,
                AKARI_DEVELOPER_MODE,
                AKARI_AGENT_TURN_END_NOTIFICATION,
                AKARI_CLOUD_ACCOUNT,
                'workbench.colorTheme'
            ].includes(change.preferenceName)) {
                this.refreshValues();
            }
        }));
    }

    protected refreshValues(): void {
        this.qualityTier = this.preferences.get<string>(AKARI_QUALITY_TIER, 'draft');
        this.theme = this.preferences.get<string>('workbench.colorTheme', 'dark');
        this.developerMode = this.preferences.get<boolean>(AKARI_DEVELOPER_MODE, false);
        this.agentTurnEndNotification = this.preferences.get<boolean>(AKARI_AGENT_TURN_END_NOTIFICATION, true);
        this.cloudAccount = this.preferences.get<string>(AKARI_CLOUD_ACCOUNT, '');
        this.update();
    }

    protected async save(name: string, value: string | boolean): Promise<void> {
        try {
            await this.preferences.set(name, value, PreferenceScope.User);
            this.saveMessage = '保存しました';
            this.refreshValues();
        } catch (error) {
            console.error('[akari-surfaces] failed to save preference', error);
            this.saveMessage = '保存できませんでした';
            this.update();
        }
    }

    protected override render(): React.ReactNode {
        const fieldStyle: React.CSSProperties = { display: 'grid', gap: 6 };
        const inputStyle: React.CSSProperties = {
            width: '100%',
            boxSizing: 'border-box',
            color: 'var(--theia-input-foreground)',
            background: 'var(--theia-input-background)',
            border: '1px solid var(--theia-input-border, var(--theia-contrastBorder))',
            borderRadius: 4,
            padding: '7px 8px'
        };
        return (
            <div className='akari-settings-surface' style={{ padding: 16, display: 'grid', gap: 18, overflow: 'auto' }}>
                <header>
                    <h2 style={{ margin: '0 0 5px' }}>AKARI 設定</h2>
                    <div style={{ opacity: 0.7 }}>動画づくりに必要な項目だけを表示しています。</div>
                </header>

                <label style={fieldStyle}>
                    <span>品質ティア</span>
                    <select aria-label='品質ティア' style={inputStyle} value={this.qualityTier}
                        onChange={event => void this.save(AKARI_QUALITY_TIER, event.currentTarget.value)}>
                        <option value='draft'>Draft — 速い確認用</option>
                        <option value='final'>Final — 最終品質</option>
                    </select>
                </label>

                <label style={fieldStyle}>
                    <span>テーマ</span>
                    <select aria-label='テーマ' style={inputStyle} value={this.theme}
                        onChange={event => void this.save('workbench.colorTheme', event.currentTarget.value)}>
                        <option value='dark'>ダーク</option>
                        <option value='light'>ライト</option>
                        {!['dark', 'light'].includes(this.theme) && <option value={this.theme}>{this.theme}</option>}
                    </select>
                </label>

                {/* Developer mode の checkbox は e2e ヘルパー（cdp-lib.mjs の
                    toggleDeveloperModeViaSettings）が「パネル内の最初の checkbox」として
                    掴むため、後続の checkbox は必ずこの下に足すこと。 */}
                <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input aria-label='Developer mode' type='checkbox' checked={this.developerMode}
                        onChange={event => void this.save(AKARI_DEVELOPER_MODE, event.currentTarget.checked)} />
                    <span>
                        <strong>Developer mode</strong><br />
                        <small style={{ opacity: 0.7 }}>HTML をコードとして開き、フル設定を利用できるようにします。</small>
                    </span>
                </label>

                <label style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <input aria-label='AI 完了通知' type='checkbox' checked={this.agentTurnEndNotification}
                        onChange={event => void this.save(AKARI_AGENT_TURN_END_NOTIFICATION, event.currentTarget.checked)} />
                    <span>
                        <strong>AI 完了通知</strong><br />
                        <small style={{ opacity: 0.7 }}>Claude Code などの処理が終わったとき、通知でお知らせします（ウィンドウが背面のときだけ）。</small>
                    </span>
                </label>

                <label style={fieldStyle}>
                    <span>Akari Cloud アカウント</span>
                    <input aria-label='Akari Cloud アカウント' style={inputStyle} type='email'
                        placeholder='name@example.com' value={this.cloudAccount}
                        onChange={event => {
                            this.cloudAccount = event.currentTarget.value;
                            this.update();
                        }}
                        onBlur={() => void this.save(AKARI_CLOUD_ACCOUNT, this.cloudAccount)} />
                    <small style={{ opacity: 0.7 }}>
                        {this.cloudAccount ? `接続先: ${this.cloudAccount}` : '未接続'}
                    </small>
                </label>

                {this.developerMode && (
                    <aside style={{ padding: 10, borderRadius: 6, background: 'var(--theia-editorWidget-background)' }}>
                        Developer mode が有効です。標準のフル設定とソースエディタも利用できます。
                    </aside>
                )}
                <div role='status' style={{ minHeight: 18, opacity: 0.7 }}>{this.saveMessage}</div>
            </div>
        );
    }
}
