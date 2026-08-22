import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { AkariPartnerWidget } from './akari-partner-widget';
import {
    PARTNER_AGENT_LABELS,
    PARTNER_CATALOG,
    PARTNER_CLI_ICON_CLASSES,
    PartnerCatalogEntry
} from './partner-catalog';

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
        const groups = PARTNER_CATALOG.reduce<Array<{
            agent: PartnerCatalogEntry['agent'];
            entries: PartnerCatalogEntry[];
        }>>((result, entry) => {
            const group = result.find(candidate => candidate.agent === entry.agent);
            if (group) {
                group.entries.push(entry);
            } else {
                result.push({ agent: entry.agent, entries: [entry] });
            }
            return result;
        }, []);

        return (
            <div style={{ padding: 14 }} data-akari-catalog-count={groups.length}>
                <h3 style={{ margin: '2px 0 6px' }}>🧩 パートナー</h3>
                <p style={{ opacity: 0.68, fontSize: 12, lineHeight: 1.45, margin: '0 0 14px' }}>
                    AKARI が確認した公式パートナーのみを表示しています。
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {groups.map(group => {
                        const cliEntry = group.entries.find(entry => entry.form === 'cli');
                        const extensionEntry = group.entries.find(entry => entry.form === 'extension');
                        return <section key={group.agent} style={cardStyle} data-partner-agent={group.agent}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                                    <span className={PARTNER_CLI_ICON_CLASSES[group.agent]} aria-hidden='true' />
                                    <strong>{PARTNER_AGENT_LABELS[group.agent]}</strong>
                                </span>
                                {group.entries.some(entry => entry.recommended) && <span style={badgeStyle}>推奨</span>}
                            </div>
                            <div style={slotsStyle}>
                                {cliEntry && this.renderSlot('CLI', cliEntry)}
                                {extensionEntry && this.renderSlot('拡張機能', extensionEntry)}
                            </div>
                        </section>;
                    })}
                </div>
                <p style={{ opacity: 0.52, fontSize: 11, marginTop: 14 }}>固定カタログ・検索なし</p>
            </div>
        );
    }

    protected renderSlot(label: string, entry: PartnerCatalogEntry): React.ReactNode {
        const verifiesBinary = entry.form === 'extension'
            && Object.values(entry.binaryVerification).some(rule => rule.required);
        return <div style={slotStyle} data-extension-id={entry.id}>
            <div style={slotLabelStyle}>{label}</div>
            <strong>{entry.name}</strong>
            <code style={{ display: 'block', marginTop: 5, opacity: 0.72, fontSize: 11 }}>{entry.id}</code>
            <p style={{ margin: '8px 0', opacity: 0.76, fontSize: 12, lineHeight: 1.4 }}>{entry.description}</p>
            {verifiesBinary && <div style={{ fontSize: 11, color: 'var(--theia-list-warningForeground, #cca700)', marginBottom: 8 }}>
                導入時にプラットフォーム用バイナリを検証
            </div>}
            <button className='theia-button secondary' onClick={() => this.onboarding.begin(entry)}>
                セットアップ
            </button>
        </div>;
    }
}

const cardStyle: React.CSSProperties = {
    padding: 12,
    border: '1px solid var(--theia-widget-border)',
    borderRadius: 7,
    background: 'var(--theia-sideBar-background)'
};

const slotsStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 10
};

const slotStyle: React.CSSProperties = {
    flex: '1 1 150px',
    minWidth: 0,
    padding: 10,
    border: '1px solid var(--theia-widget-border)',
    borderRadius: 5
};

const slotLabelStyle: React.CSSProperties = {
    marginBottom: 6,
    opacity: 0.62,
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.06em'
};

const badgeStyle: React.CSSProperties = {
    borderRadius: 9,
    padding: '2px 7px',
    fontSize: 10,
    color: 'var(--theia-button-foreground)',
    background: 'var(--theia-button-background)'
};
