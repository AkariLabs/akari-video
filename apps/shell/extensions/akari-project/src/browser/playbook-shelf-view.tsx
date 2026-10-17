import * as React from '@theia/core/shared/react';
import { playbookDragPayload, playbookShelfAction } from '../common/playbook-shelf';
import { t } from '../common/project-text';

interface Entry { dir: string; source: 'channel' | 'local' | 'lab'; coverUri?: string; frameUris?: string[];
    playbook: { id: string; name: string; depth: number; placeholders?: { id: string }[] } }
interface Props { service: { listPlaybooks(channel?: string): Promise<Entry[]> }; channel?: string; openMarkdown(dir: string): void }

export function PlaybookShelfView({ service, channel, openMarkdown }: Props): React.ReactElement {
    const [entries, setEntries] = React.useState<Entry[]>([]);
    const [loading, setLoading] = React.useState(true);
    React.useEffect(() => { let active = true; setLoading(true); void service.listPlaybooks(channel).then(value => { if (active) { setEntries(value.filter(entry => entry.playbook.depth === 3)); setLoading(false); } })
        .catch(() => { if (active) { setEntries([]); setLoading(false); } });
        return () => { active = false; }; }, [service, channel]);
    // 親の分類グリッドの 1 列に収まらないよう全幅に広げる（134px に畳まれて印が縦に折れていた）
    return <section data-akari-playbook-shelf style={{ padding: '10px', gridColumn: '1 / -1', width: '100%', minWidth: 0, boxSizing: 'border-box' }}>
        <strong>{t('project.library.playbook.shelfLabel')}</strong>
        {!loading && entries.length === 0 && <div data-akari-playbook-shelf-empty style={{ marginTop: 8, lineHeight: 1.5 }}>
            <div>{t('project.library.playbook.empty.title')}</div>
            <div>{t('project.library.playbook.empty.description')}</div>
            <code style={{ display: 'block', marginTop: 4, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>{t('project.library.playbook.empty.command')}</code>
        </div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8, marginTop: 8 }}>
            {entries.map(entry => {
                const action = playbookShelfAction(entry.playbook);
                return <button key={`${entry.source}/${entry.playbook.id}`} type='button' className='akari-playbook-card'
                    data-akari-playbook-id={entry.playbook.id} data-akari-playbook-depth={entry.playbook.depth}
                    draggable={action === 'drag'} onClick={() => { if (action === 'open') openMarkdown(entry.dir); }}
                    onDragStart={event => { if (action !== 'drag') { event.preventDefault(); return; }
                        event.dataTransfer.setData('application/x-akari-library-item', JSON.stringify(playbookDragPayload(entry.playbook, entry.dir)));
                        event.dataTransfer.effectAllowed = 'copy'; }}
                    style={{ border: '1px solid var(--theia-panel-border)', background: 'var(--theia-sideBar-background)', color: 'inherit', padding: 6, textAlign: 'left', minWidth: 0 }}>
                    {(entry.coverUri || entry.frameUris?.[0]) && <img data-akari-playbook-cover src={entry.coverUri || entry.frameUris?.[0]} alt='' style={{ width: '100%', aspectRatio: '16 / 9', objectFit: 'cover' }} />}
                    <span>{entry.playbook.name}</span>{entry.playbook.depth === 3 && <b data-akari-template-badge style={{ marginLeft: 6, whiteSpace: 'nowrap', fontSize: 11 }}>{t('project.library.playbook.templateBadge')}</b>}
                    <small style={{ display: 'block', opacity: 0.7 }}>{t(`project.library.playbook.source.${entry.source}`)}</small>
                </button>;
            })}
        </div>
    </section>;
}
