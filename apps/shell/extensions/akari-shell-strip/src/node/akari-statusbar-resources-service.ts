import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as os from 'node:os';
import { promises as fs } from 'node:fs';
import { injectable } from '@theia/core/shared/inversify';
import { AkariStatusbarResourcesService } from '../common/statusbar-resources-protocol';
import { parseIoregGpuUtilization, parseVmStatUsedBytes, ResourceSample } from '../common/statusbar-resources';

const exec = promisify(execFile);

@injectable()
export class AkariStatusbarResourcesServiceImpl implements AkariStatusbarResourcesService {
    protected previousCpu: { idle: number; total: number } | undefined;

    async sample(pids: number[]): Promise<ResourceSample> {
        const times = os.cpus().map(cpu => cpu.times);
        const current = times.reduce((sum, time) => ({
            idle: sum.idle + time.idle,
            total: sum.total + time.user + time.nice + time.sys + time.idle + time.irq
        }), { idle: 0, total: 0 });
        const previous = this.previousCpu;
        this.previousCpu = current;
        const deltaTotal = current.total - (previous?.total ?? current.total);
        const cpuPercent = deltaTotal > 0 ? Math.max(0, Math.min(100, (1 - (current.idle - previous!.idle) / deltaTotal) * 100)) : null;
        const [gpuPercent, disk, rssByPid, memoryUsedBytes] = await Promise.all([
            this.gpu(), this.disk(), this.rss(pids), this.memoryUsed()
        ]);
        return {
            cpuPercent, gpuPercent,
            memoryUsedBytes, memoryTotalBytes: os.totalmem(),
            diskFreeBytes: disk?.free ?? null, diskTotalBytes: disk?.total ?? null,
            rssByPid, username: os.userInfo().username, sampledAt: Date.now()
        };
    }

    protected async memoryUsed(): Promise<number> {
        const fallback = os.totalmem() - os.freemem();
        if (process.platform !== 'darwin') return fallback;
        try {
            const { stdout } = await exec('vm_stat', [], { timeout: 2000, maxBuffer: 1_000_000 });
            return parseVmStatUsedBytes(stdout) ?? fallback;
        } catch { return fallback; }
    }

    protected async gpu(): Promise<number | null> {
        try {
            if (process.platform === 'darwin') {
                const { stdout } = await exec('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], { timeout: 2000, maxBuffer: 4_000_000 });
                return parseIoregGpuUtilization(stdout);
            }
            if (process.platform === 'win32') {
                const { stdout } = await exec('nvidia-smi', ['--query-gpu=utilization.gpu', '--format=csv,noheader,nounits'], { timeout: 2000 });
                const values = stdout.split(/\r?\n/).map(Number).filter(value => Number.isFinite(value) && value >= 0 && value <= 100);
                return values.length ? Math.round(Math.max(...values)) : null;
            }
        } catch { /* 未対応 GPU は UI に出さない。 */ }
        return null;
    }

    protected async disk(): Promise<{ free: number; total: number } | null> {
        try {
            const stat = await fs.statfs(os.homedir());
            const total = stat.blocks * stat.bsize;
            const free = stat.bavail * stat.bsize;
            return Number.isFinite(total) && Number.isFinite(free) && total > 0 ? { total, free } : null;
        } catch { return null; }
    }

    protected async rss(pids: number[]): Promise<Record<string, number>> {
        const valid = [...new Set(pids)].filter(pid => Number.isSafeInteger(pid) && pid > 0).slice(0, 32);
        if (!valid.length || process.platform === 'win32') return {};
        try {
            const { stdout } = await exec('ps', ['-o', 'pid=,rss=', '-p', valid.join(',')], { timeout: 2000 });
            return Object.fromEntries(stdout.trim().split(/\r?\n/).map(line => {
                const [pid, kib] = line.trim().split(/\s+/).map(Number);
                return [String(pid), kib * 1024];
            }).filter(([pid, bytes]) => pid !== 'NaN' && Number.isFinite(bytes)));
        } catch { return {}; }
    }
}
