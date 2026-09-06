import { readFile, writeFile } from 'node:fs/promises';

const plan = JSON.parse(await readFile(process.env.AKARI_TEST_WAVEFORM_PLAN, 'utf8'));
await writeFile(plan.argsOut, JSON.stringify(process.argv.slice(2)));
const write = (stream, bytes) => new Promise((resolve, reject) => {
    stream.write(bytes, error => error ? reject(error) : resolve());
});
if (plan.stderr) await write(process.stderr, plan.stderr);
for (const segment of plan.segments) {
    const sample = Math.round(Math.min(1, Math.max(0, segment.amplitude)) * -32768);
    const chunkBytes = plan.chunkBytes || 4095;
    let byteOffset = 0;
    while (byteOffset < segment.samples * 2) {
        const chunk = Buffer.alloc(Math.min(chunkBytes, segment.samples * 2 - byteOffset));
        for (let i = 0; i < chunk.length; i += 1) {
            chunk[i] = ((byteOffset + i) % 2 === 0 ? sample : sample >> 8) & 255;
        }
        await write(process.stdout, chunk);
        byteOffset += chunk.length;
        if (plan.chunkDelayMs) await new Promise(resolve => setTimeout(resolve, plan.chunkDelayMs));
    }
}
process.exitCode = plan.exitCode;
