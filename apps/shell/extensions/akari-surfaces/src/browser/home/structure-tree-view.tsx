import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { t } from '@akari-video/i18n';
import { StructureTree } from '../../common/project-structure-model';

const time = (seconds: number | undefined): string => seconds === undefined ? '—' : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export function StructureTreeView({ root, tree, onOpen }: { root: URI; tree: StructureTree; onOpen(uri: URI): void }): React.ReactElement {
    return <div data-akari-structure-tree='true' style={{ display: 'grid', gap: 7 }}>
        <strong>{tree.name} · {tree.scenes.length} {t('surfaces.structure.scenes.label')}</strong>
        {tree.scenes.map(scene => <div key={scene.id} style={{ paddingLeft: 18 }}>
            <button type='button' data-akari-structure-scene={scene.id} onClick={() => onOpen(root.resolve(`scenes/${scene.id}`))}
                style={{ border: 0, background: 'transparent', color: 'var(--theia-foreground)', textAlign: 'left', cursor: 'pointer', padding: '6px 0' }}>
                <b>▸ {scene.title}</b> · {scene.unreadable ? t('surfaces.structure.unreadable.label') : time(scene.duration)}
                {!scene.unreadable && <> · {scene.placeholders > 0 ? `${t('surfaces.structure.placeholder.label')} ${scene.placeholders} · ` : ''}
                    {scene.captions ? `${t('surfaces.structure.captions.label')} · ` : ''}
                    {scene.exported ? t('surfaces.structure.exported.label') : t('surfaces.structure.inProgress.label')}</>}
            </button>
            {!scene.unreadable && scene.cuts.map(cut => <button key={cut.id} type='button' onClick={() => onOpen(root.resolve(`scenes/${scene.id}`))}
                data-akari-structure-cut={cut.id} style={{ display: 'block', marginLeft: 20, padding: '3px 8px', border: 0, background: 'transparent',
                    color: 'var(--theia-descriptionForeground)', cursor: 'pointer', textAlign: 'left' }}>
                {cut.order}. {cut.asset} · {time(cut.duration)} {cut.placeholder ? `· ${t('surfaces.structure.placeholder.label')}` : ''}
            </button>)}
        </div>)}
    </div>;
}
