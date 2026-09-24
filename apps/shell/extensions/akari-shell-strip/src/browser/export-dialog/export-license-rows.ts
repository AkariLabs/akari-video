import { QuickExportLicenseFinding } from '../../common/quick-export-protocol';

export type LicenseRowKind = 'non-commercial' | 'unknown' | 'attribution';
export interface LicenseRow {
    readonly kind: LicenseRowKind;
    readonly label: string;
    readonly preview: string;
    readonly names: readonly string[];
    readonly credits: readonly string[];
}

const CHECKS: readonly [LicenseRowKind, QuickExportLicenseFinding['check'], string][] = [
    ['non-commercial', 'license.non-commercial', '商用利用できない素材が'],
    ['unknown', 'license.unknown', 'ライセンスが分からない素材が'],
    ['attribution', 'license.attribution', '帰属表示が必要な素材が']
];

export function buildLicenseRows(findings: readonly QuickExportLicenseFinding[]): readonly LicenseRow[] {
    return CHECKS.flatMap(([kind, check, prefix]) => {
        const entries = findings.filter(finding => finding.check === check);
        if (!entries.length) return [];
        const names = entries.map(entry => entry.details.name);
        const extra = names.length > 3 ? `、ほか ${names.length - 3} 件` : '';
        return [{
            kind,
            label: `${prefix} ${names.length} 件`,
            preview: `${names.slice(0, 3).join('、')}${extra}`,
            names,
            credits: [...new Set(entries.map(entry => entry.details.credit).filter(Boolean))]
        }];
    });
}
