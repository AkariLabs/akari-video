import { randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { basename, dirname, extname, isAbsolute, join, relative, sep } from 'path';
import { pathToFileURL } from 'url';
import { VoiceRecordingFinishResult, VoiceRecordingStartResult } from '../common/akari-project-protocol';
import {
    VOICE_RECORDING_DIRECTORY, VOICE_RECORDING_MIN_SEC, VOICE_RECORDING_SAMPLE_RATE, voiceRecordingFileName
} from '../common/voice-recording';

const HEADER_BYTES = 44;
const BYTES_PER_SAMPLE = 2;

interface ActiveRecording {
    root: string;
    wavPath: string;
    relativePath: string;
    startedAt: string;
    tail: Promise<void>;
}

function wavHeader(dataBytes: number): Buffer {
    const header = Buffer.alloc(HEADER_BYTES);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataBytes, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(VOICE_RECORDING_SAMPLE_RATE, 24);
    header.writeUInt32LE(VOICE_RECORDING_SAMPLE_RATE * BYTES_PER_SAMPLE, 28);
    header.writeUInt16LE(BYTES_PER_SAMPLE, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataBytes, 40);
    return header;
}

export class VoiceRecordingWriter {
    protected readonly recordings = new Map<string, ActiveRecording>();

    async start(projectRoot: string): Promise<VoiceRecordingStartResult> {
        const root = await fs.realpath(projectRoot);
        const directory = join(root, VOICE_RECORDING_DIRECTORY);
        await fs.mkdir(directory, { recursive: true });
        const actualDirectory = await fs.realpath(directory);
        const within = relative(root, actualDirectory);
        if (within === '..' || within.startsWith(`..${sep}`) || isAbsolute(within)) {
            throw new Error('Recording destination is outside the project');
        }
        const requested = basename(voiceRecordingFileName(new Date())).replace(/[^\p{L}\p{N}._ -]/gu, '_');
        const extension = extname(requested);
        const stem = basename(requested, extension);
        let name = requested;
        let index = 2;
        let wavPath: string;
        for (;;) {
            wavPath = join(actualDirectory, name);
            try {
                await fs.writeFile(wavPath, wavHeader(0), { flag: 'wx' });
                break;
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
                name = `${stem}-${index++}${extension}`;
            }
        }
        const recordingId = randomBytes(8).toString('hex');
        const relativePath = `${VOICE_RECORDING_DIRECTORY}/${name}`;
        this.recordings.set(recordingId, { root, wavPath, relativePath, startedAt: new Date().toISOString(), tail: Promise.resolve() });
        return { recordingId, relativePath };
    }

    async append(request: { recordingId: string; pcmBase64: string }): Promise<void> {
        const recording = this.recordings.get(request?.recordingId);
        if (!recording) throw new Error('Unknown voice recording');
        if (typeof request.pcmBase64 !== 'string') throw new Error('Invalid PCM payload');
        const pcm = Buffer.from(request.pcmBase64, 'base64');
        if (pcm.length % BYTES_PER_SAMPLE !== 0) throw new Error('PCM payload must contain complete 16-bit samples');
        if (!pcm.length) return;
        recording.tail = recording.tail.then(async () => {
            const handle = await fs.open(recording.wavPath, 'r+');
            try {
                const current = await handle.stat();
                if (current.size < HEADER_BYTES) throw new Error('Voice recording WAV header is missing');
                const dataBytes = current.size - HEADER_BYTES + pcm.length;
                if (dataBytes > 0xffffffff - 36) throw new Error('Voice recording is too large');
                await handle.write(pcm, 0, pcm.length, current.size);
                const sizes = Buffer.alloc(4);
                sizes.writeUInt32LE(36 + dataBytes);
                await handle.write(sizes, 0, 4, 4);
                sizes.writeUInt32LE(dataBytes);
                await handle.write(sizes, 0, 4, 40);
                await handle.sync();
            } finally {
                await handle.close();
            }
        });
        await recording.tail;
    }

    async finish(request: { recordingId: string; discard?: boolean }): Promise<VoiceRecordingFinishResult | undefined> {
        const recording = this.recordings.get(request?.recordingId);
        if (!recording) throw new Error('Unknown voice recording');
        this.recordings.delete(request.recordingId);
        await recording.tail;
        const stat = await fs.stat(recording.wavPath);
        const dataBytes = stat.size - HEADER_BYTES;
        if (request.discard || dataBytes < VOICE_RECORDING_SAMPLE_RATE * BYTES_PER_SAMPLE * VOICE_RECORDING_MIN_SEC) {
            await fs.rm(recording.wavPath, { force: true });
            return undefined;
        }
        const id = `${new Date().toISOString().replace(/[:.]/g, '-')}-audio-added-${randomBytes(3).toString('hex')}`;
        const eventPath = join(recording.root, '.akari', 'events', `${id}.json`);
        const event = { version: 1, id, type: 'audio-added', occurredAt: new Date().toISOString(),
            asset: recording.relativePath, source: 'microphone', copied: false };
        await fs.mkdir(dirname(eventPath), { recursive: true });
        const temporary = `${eventPath}.${process.pid}.tmp`;
        try {
            await fs.writeFile(temporary, `${JSON.stringify(event, null, 2)}\n`, { flag: 'wx' });
            await fs.rename(temporary, eventPath);
        } finally {
            await fs.rm(temporary, { force: true });
        }
        return { assetPath: recording.relativePath, durationSec: dataBytes / (VOICE_RECORDING_SAMPLE_RATE * BYTES_PER_SAMPLE),
            eventUri: pathToFileURL(eventPath).toString() };
    }
}
