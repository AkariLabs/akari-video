import test from 'node:test';
import assert from 'node:assert/strict';
import {
    parseIoregGpuUtilization, parseVmStatUsedBytes, resolveStatusbarOptions, resourceRows, resourceSummary
} from '../lib/common/statusbar-resources.js';

const sample = {
    cpuPercent: 38.2, gpuPercent: 21, memoryUsedBytes: 11_400_000_000,
    memoryTotalBytes: 16_000_000_000, diskFreeBytes: 240_000_000_000,
    diskTotalBytes: 500_000_000_000, rssByPid: {}, username: 'ryoma', sampledAt: 1
};

test('未登録キーは既定値で、明示 false と変更した間隔を反映する', () => {
    const options = resolveStatusbarOptions(key => ({
        'akari.statusBar.cpu': false, 'akari.statusBar.disk': true, 'akari.statusBar.intervalSec': 5
    })[key]);
    assert.deepEqual(options, {
        cpu: false, gpu: true, memory: true, disk: true,
        running: true, intervalSec: 5, accountBalance: false
    });
    assert.equal(resolveStatusbarOptions(() => undefined).intervalSec, 3);
});

test('ioreg の PerformanceStatistics 利用率を取り、無ければ null', () => {
    assert.equal(parseIoregGpuUtilization('"PerformanceStatistics" = {"Device Utilization %"=21,"Foo"=1}'), 21);
    assert.equal(parseIoregGpuUtilization('"Device Utilization %" = 22\n"Device Utilization %" = 41'), 41);
    assert.equal(parseIoregGpuUtilization('"Device Utilization %" = 999'), null);
    assert.equal(parseIoregGpuUtilization('"IOAccelerator" = {}'), null);
});

test('vm_stat は active + wired + compressor のみをページサイズでバイトへ変換する', () => {
    const output = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free: 75362.
Pages active: 153321.
Pages inactive: 188139.
Pages wired down: 227407.
Pages purgeable: 46.
Pages occupied by compressor: 350707.\n`;
    assert.equal(parseVmStatUsedBytes(output), (153321 + 227407 + 350707) * 16384);
    assert.equal(parseVmStatUsedBytes(output.replace('350707.', '350,707.')), (153321 + 227407 + 350707) * 16384);
    assert.equal(parseVmStatUsedBytes(output.replace('Pages wired down: 227407.\n', '')), null);
    assert.equal(parseVmStatUsedBytes('vm_stat failed'), null);
});

test('下のバーは設定で項目を消し、取得不能 GPU も消す', () => {
    const options = resolveStatusbarOptions(() => undefined);
    assert.equal(resourceSummary(sample, options, 3), 'CPU 38% · GPU 21% · メモリ 11.4 GB · 実行中 3');
    assert.equal(resourceSummary({ ...sample, gpuPercent: null }, { ...options, cpu: false, memory: false }, 0), '実行中 0');
    assert.deepEqual(resourceRows({ ...sample, gpuPercent: null }, { ...options, disk: true }).map(row => row.key), ['cpu', 'memory', 'disk']);
});
