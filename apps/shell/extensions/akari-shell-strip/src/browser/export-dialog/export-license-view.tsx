import * as React from '@theia/core/shared/react';
import { QuickExportLicenseFinding } from '../../common/quick-export-protocol';
import { buildLicenseRows, LicenseRowKind } from './export-license-rows';

function LicenseLine(props: {
    kind: LicenseRowKind;
    label: string;
    preview: string;
    names: readonly string[];
    credits: readonly string[];
    onCopy: (text: string) => Promise<boolean>;
}): React.ReactNode {
    const [open, setOpen] = React.useState(false);
    const [copied, setCopied] = React.useState(false);
    const copyResetTimer = React.useRef<number | undefined>(undefined);
    React.useEffect(() => () => {
        if (copyResetTimer.current !== undefined) window.clearTimeout(copyResetTimer.current);
    }, []);
    const copyCredits = async (): Promise<void> => {
        if (!await props.onCopy(props.credits.join('\n'))) return;
        setCopied(true);
        if (copyResetTimer.current !== undefined) window.clearTimeout(copyResetTimer.current);
        copyResetTimer.current = window.setTimeout(() => {
            setCopied(false);
            copyResetTimer.current = undefined;
        }, 2000);
    };
    return <div className={`license-row ${props.kind}`} data-akari-license-row={props.kind}>
        <div className='license-main'>
            <button type='button' className='license-toggle' data-akari-license-toggle
                aria-expanded={open} onClick={() => setOpen(value => !value)}>
                {props.label}（{props.preview}）
            </button>
            {props.kind === 'attribution' && props.credits.length > 0 &&
                <button type='button' className='license-copy' data-akari-license-copy-credit
                    onClick={() => void copyCredits()}>
                    {copied ? 'コピーしました' : 'クレジットをコピー'}
                </button>}
        </div>
        {open && <ul data-akari-license-names>{props.names.map((name, index) => <li key={`${name}-${index}`}>{name}</li>)}</ul>}
    </div>;
}

export function ExportLicenseView(props: {
    findings: readonly QuickExportLicenseFinding[];
    onCopy: (text: string) => Promise<boolean>;
}): React.ReactNode {
    const rows = buildLicenseRows(props.findings);
    if (!rows.length) return undefined;
    return <div className='license-rows'>{rows.map(row => <LicenseLine key={row.kind} {...row} onCopy={props.onCopy} />)}</div>;
}
