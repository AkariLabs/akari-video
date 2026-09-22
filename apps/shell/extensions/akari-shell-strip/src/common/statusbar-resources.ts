export interface StatusbarOptions {
    cpu: boolean; gpu: boolean; memory: boolean; disk: boolean;
    running: boolean; intervalSec: number; accountBalance: boolean;
}

export const STATUSBAR_DEFAULTS: StatusbarOptions = {
    cpu: true, gpu: true, memory: true, disk: false,
    running: true, intervalSec: 3, accountBalance: false
};

export function resolveStatusbarOptions(read: (key: string) => unknown): StatusbarOptions {
    const flag = (key: keyof StatusbarOptions): boolean => {
        const value = read(`akari.statusBar.${key}`);
        return typeof value === 'boolean' ? value : STATUSBAR_DEFAULTS[key] as boolean;
    };
    const interval = read('akari.statusBar.intervalSec');
    return {
        cpu: flag('cpu'), gpu: flag('gpu'), memory: flag('memory'), disk: flag('disk'),
        running: flag('running'), accountBalance: flag('accountBalance'),
        intervalSec: typeof interval === 'number' && Number.isFinite(interval) && interval >= 1
            ? Math.min(60, interval) : STATUSBAR_DEFAULTS.intervalSec
    };
}

export function parseIoregGpuUtilization(output: string): number | null {
    const matches = [...output.matchAll(/"Device Utilization %"\s*=\s*(\d+(?:\.\d+)?)/g)]
        .map(match => Number(match[1])).filter(value => Number.isFinite(value) && value >= 0 && value <= 100);
    return matches.length ? Math.round(Math.max(...matches)) : null;
}

/** vm_stat の active + wired + compressor（Activity Monitor の使用済みメモリ相当）。 */
export function parseVmStatUsedBytes(output: string): number | null {
    const pageSize = Number(output.match(/page size of\s+([\d,]+)\s+bytes/i)?.[1]?.replace(/,/g, ''));
    if (!Number.isSafeInteger(pageSize) || pageSize <= 0) return null;
    const pages = (label: string): number | null => {
        const match = output.match(new RegExp(`^${label}:\\s+([\\d,]+)\\.?\\s*$`, 'm'));
        if (!match) return null;
        const count = Number(match[1].replace(/,/g, ''));
        return Number.isSafeInteger(count) && count >= 0 ? count : null;
    };
    const active = pages('Pages active');
    const wired = pages('Pages wired down');
    const compressor = pages('Pages occupied by compressor');
    if (active === null || wired === null || compressor === null) return null;
    const bytes = (active + wired + compressor) * pageSize;
    return Number.isSafeInteger(bytes) ? bytes : null;
}

export interface ResourceSample {
    cpuPercent: number | null;
    gpuPercent: number | null;
    memoryUsedBytes: number;
    memoryTotalBytes: number;
    diskFreeBytes: number | null;
    diskTotalBytes: number | null;
    rssByPid: Record<string, number>;
    username: string;
    sampledAt: number;
}

export interface RunningItem {
    id: string; icon: string; label: string; memoryBytes: number | null; stoppable: boolean;
}

export function formatGb(bytes: number): string {
    return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

export function resourceSummary(sample: ResourceSample, options: StatusbarOptions, runningCount: number): string {
    const parts: string[] = [];
    if (options.cpu && sample.cpuPercent !== null) parts.push(`CPU ${Math.round(sample.cpuPercent)}%`);
    if (options.gpu && sample.gpuPercent !== null) parts.push(`GPU ${Math.round(sample.gpuPercent)}%`);
    if (options.memory) parts.push(`メモリ ${formatGb(sample.memoryUsedBytes)}`);
    if (options.disk && sample.diskFreeBytes !== null) parts.push(`ディスク 残 ${Math.round(sample.diskFreeBytes / 1_000_000_000)} GB`);
    if (options.running) parts.push(`実行中 ${runningCount}`);
    return parts.join(' · ');
}

export function resourceRows(sample: ResourceSample, options: StatusbarOptions): Array<{ key: string; label: string; value: string; percent: number }> {
    const rows: Array<{ key: string; label: string; value: string; percent: number }> = [];
    const clamp = (n: number): number => Math.max(0, Math.min(100, n));
    if (options.cpu && sample.cpuPercent !== null) rows.push({ key: 'cpu', label: 'CPU（機械全体）', value: `${Math.round(sample.cpuPercent)}%`, percent: clamp(sample.cpuPercent) });
    if (options.gpu && sample.gpuPercent !== null) rows.push({ key: 'gpu', label: 'GPU', value: `${Math.round(sample.gpuPercent)}%`, percent: clamp(sample.gpuPercent) });
    if (options.memory) rows.push({ key: 'memory', label: 'メモリ（機械全体）', value: formatGb(sample.memoryUsedBytes), percent: clamp(sample.memoryUsedBytes / sample.memoryTotalBytes * 100) });
    if (options.disk && sample.diskFreeBytes !== null && sample.diskTotalBytes) rows.push({ key: 'disk', label: 'ディスク', value: `残 ${Math.round(sample.diskFreeBytes / 1_000_000_000)} GB`, percent: clamp((sample.diskTotalBytes - sample.diskFreeBytes) / sample.diskTotalBytes * 100) });
    return rows;
}
