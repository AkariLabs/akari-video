import * as React from '@theia/core/shared/react';
import URI from '@theia/core/lib/common/uri';
import { t } from '@akari-video/i18n';
import { AkariProjectStructureService } from '../../common/project-structure-protocol';
import { ManifestCheck, inspectionCounts, inspectionLabel } from '../../common/project-structure-model';

export function InspectionBand({ root, service, onRelations }: { root: URI; service: AkariProjectStructureService; onRelations(): void }): React.ReactElement | null {
    const [check, setCheck] = React.useState<ManifestCheck | undefined>();
    React.useEffect(() => {
        let active = true;
        void service.readCheck(root.toString()).then(value => { if (active) setCheck(value); }).catch(() => undefined);
        return () => { active = false; };
    }, [root.toString(), service]);
    const counts = inspectionCounts(check);
    if (!counts.error && !counts.warning) return null;
    return <div className='akari-os-inspection-band' data-akari-inspection-band='true' role='status'
        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '9px 13px', border: '1px solid var(--theia-inputValidation-warningBorder)', borderRadius: 8,
            background: 'var(--theia-inputValidation-warningBackground)', marginBottom: 12 }}>
        <strong>{t('surfaces.structure.inspection.label')}: {inspectionLabel(counts, t)}</strong>
        <button type='button' onClick={onRelations} style={{ marginLeft: 'auto', background: 'transparent', border: 0,
            color: 'var(--theia-textLink-foreground)', cursor: 'pointer' }}>{t('surfaces.structure.viewRelations.button')}</button>
    </div>;
}
