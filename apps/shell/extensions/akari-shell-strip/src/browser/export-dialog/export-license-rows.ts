import { t } from '../../common/shell-text';
import { QuickExportLicenseFinding } from '../../common/quick-export-protocol';

export type LicenseRowKind = 'non-commercial' | 'unknown' | 'attribution';
export interface LicenseRow {
    readonly kind: LicenseRowKind;
    readonly label: string;
    readonly preview: string;
    readonly names: readonly string[];
    readonly credits: readonly string[];
}

const checks = (): readonly [LicenseRowKind, QuickExportLicenseFinding['check'], string][] => [
    ['non-commercial', 'license.non-commercial', t('shell.exportDialog.license.assetsCannotUsedCommerciallyText')],
    ['unknown', 'license.unknown', t('shell.exportDialog.license.assetsUnknownLicensesText')],
    ['attribution', 'license.attribution', t('shell.exportDialog.license.assetsRequiringAttributionText')]
];

export function buildLicenseRows(findings: readonly QuickExportLicenseFinding[]): readonly LicenseRow[] {
    return checks().flatMap(([kind, check, prefix]) => {
        const entries = findings.filter(finding => finding.check === check);
        if (!entries.length) return [];
        const names = entries.map(entry => entry.details.name);
        const extra = names.length > 3 ? t('shell.exportDialog.license.plusMoreLabel', { value1: names.length - 3 }) : '';
        return [{
            kind,
            label: t('shell.exportDialog.license.licenseCountLabel', { value1: prefix, value2: names.length }),
            preview: `${names.slice(0, 3).join(t('shell.exportDialog.license.nameSeparator'))}${extra}`,
            names,
            credits: [...new Set(entries.map(entry => entry.details.credit).filter(Boolean))]
        }];
    });
}
