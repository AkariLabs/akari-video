import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { AkariPartnerWidget } from './akari-partner-widget';
import { PARTNER_CATALOG } from './partner-catalog';

@injectable()
export class AkariPartnerCatalogWidget extends ReactWidget {

    static readonly FACTORY_ID = 'akari-partner-catalog-factory';
    static readonly ID = 'vsx-extensions-view-container';

    @inject(AkariPartnerWidget)
    protected readonly onboarding!: AkariPartnerWidget;

    @postConstruct()
    protected init(): void {
        this.id = AkariPartnerCatalogWidget.ID;
        this.title.label = 'パートナー / 拡張';
        this.title.caption = 'キュレーション済みパートナー';
        this.title.iconClass = 'codicon codicon-extensions';
        this.title.closable = false;
        this.update();
    }

    protected render(): React.ReactNode {
        return (
            <div style={{ padding: 14 }} data-akari-catalog-count={PARTNER_CATALOG.length}>
                <h3 style={{ margin: '2px 0 6px' }}>🧩 パートナー</h3>
                <p style={{ opacity: 0.68, fontSize: 12, lineHeight: 1.45, margin: '0 0 14px' }}>
                    AKARI が確認した公式パートナーのみを表示しています。
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {PARTNER_CATALOG.map(entry => {
                        const verifiesBinary = Object.values(entry.binaryVerification).some(rule => rule.required);
                        return <section key={entry.id} style={cardStyle} data-extension-id={entry.id}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                                <strong>{entry.name}</strong>
                                {entry.recommended && <span style={badgeStyle}>推奨</span>}
                            </div>
                            <code style={{ display: 'block', marginTop: 5, opacity: 0.72, fontSize: 11 }}>{entry.id}</code>
                            <p style={{ margin: '8px 0', opacity: 0.76, fontSize: 12, lineHeight: 1.4 }}>{entry.description}</p>
                            {verifiesBinary && <div style={{ fontSize: 11, color: 'var(--theia-warningForeground)', marginBottom: 8 }}>
                                導入時にプラットフォーム用バイナリを検証
                            </div>}
                            <button className='theia-button secondary' onClick={() => this.onboarding.begin(entry)}>
                                セットアップ
                            </button>
                        </section>;
                    })}
                </div>
                <p style={{ opacity: 0.52, fontSize: 11, marginTop: 14 }}>固定カタログ・検索なし</p>
            </div>
        );
    }
}

const cardStyle: React.CSSProperties = {
    padding: 12,
    border: '1px solid var(--theia-widget-border)',
    borderRadius: 7,
    background: 'var(--theia-sideBar-background)'
};

const badgeStyle: React.CSSProperties = {
    borderRadius: 9,
    padding: '2px 7px',
    fontSize: 10,
    color: 'var(--theia-button-foreground)',
    background: 'var(--theia-button-background)'
};
