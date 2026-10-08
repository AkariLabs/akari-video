import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export interface SystemOutputVolume {
    volume: number;
    muted: boolean;
}

export function parseMacOutputVolume(stdout: string): SystemOutputVolume | undefined {
    const volume = /(?:^|,)\s*output volume:\s*(\d+|missing value)(?=\s*,|\s*$)/.exec(stdout);
    const muted = /(?:^|,)\s*output muted:\s*(true|false|missing value)(?=\s*,|\s*$)/.exec(stdout);
    if (!volume || !muted) return undefined;
    if (volume[1] === 'missing value') return muted[1] === 'true' ? { volume: 100, muted: true } : undefined;
    const value = Number(volume[1]);
    if (!Number.isInteger(value) || value < 0 || value > 100) return undefined;
    return { volume: value, muted: muted[1] === 'true' };
}

export function parseWindowsOutputVolume(stdout: string): SystemOutputVolume | undefined {
    try {
        const value: unknown = JSON.parse(stdout.trim());
        if (!value || typeof value !== 'object') return undefined;
        const result = value as Record<string, unknown>;
        if (typeof result.volume !== 'number' || !Number.isFinite(result.volume)
            || result.volume < 0 || result.volume > 100 || typeof result.muted !== 'boolean') return undefined;
        return { volume: result.volume, muted: result.muted };
    } catch {
        return undefined;
    }
}

const WINDOWS_OUTPUT_VOLUME_SOURCE = [
    'using System;',
    'using System.Runtime.InteropServices;',
    'public enum EDataFlow { Render, Capture, All }',
    'public enum ERole { Console, Multimedia, Communications }',
    '[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]',
    'public class MMDeviceEnumerator { }',
    '[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    'public interface IMMDeviceEnumerator {',
    ' void EnumAudioEndpoints(EDataFlow flow, int stateMask, out object devices);',
    ' void GetDefaultAudioEndpoint(EDataFlow flow, ERole role, out IMMDevice device);',
    ' void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IMMDevice device);',
    ' void RegisterEndpointNotificationCallback(IntPtr client);',
    ' void UnregisterEndpointNotificationCallback(IntPtr client);',
    '}',
    '[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    'public interface IMMDevice {',
    ' void Activate(ref Guid iid, int context, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);',
    ' void OpenPropertyStore(int access, out IntPtr store);',
    ' void GetId(out IntPtr id);',
    ' void GetState(out int state);',
    '}',
    '[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]',
    'public interface IAudioEndpointVolume {',
    ' void RegisterControlChangeNotify(IntPtr notify);',
    ' void UnregisterControlChangeNotify(IntPtr notify);',
    ' void GetChannelCount(out uint count);',
    ' void SetMasterVolumeLevel(float level, IntPtr context);',
    ' void SetMasterVolumeLevelScalar(float level, IntPtr context);',
    ' void GetMasterVolumeLevel(out float level);',
    ' void GetMasterVolumeLevelScalar(out float level);',
    ' void SetChannelVolumeLevel(uint channel, float level, IntPtr context);',
    ' void SetChannelVolumeLevelScalar(uint channel, float level, IntPtr context);',
    ' void GetChannelVolumeLevel(uint channel, out float level);',
    ' void GetChannelVolumeLevelScalar(uint channel, out float level);',
    ' void SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, IntPtr context);',
    ' void GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);',
    '}',
    'public static class OutputVolumeReader {',
    ' public static string Read() {',
    '  IMMDeviceEnumerator enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();',
    '  IMMDevice device;',
    '  enumerator.GetDefaultAudioEndpoint(EDataFlow.Render, ERole.Multimedia, out device);',
    '  Guid iid = typeof(IAudioEndpointVolume).GUID;',
    '  object instance;',
    '  device.Activate(ref iid, 23, IntPtr.Zero, out instance);',
    '  IAudioEndpointVolume endpoint = (IAudioEndpointVolume)instance;',
    '  float scalar;',
    '  bool muted;',
    '  endpoint.GetMasterVolumeLevelScalar(out scalar);',
    '  endpoint.GetMute(out muted);',
    '  return "{\\"volume\\":" + (scalar * 100).ToString(System.Globalization.CultureInfo.InvariantCulture)',
    '      + ",\\"muted\\":" + (muted ? "true" : "false") + "}";',
    ' }',
    '}'
].join('\n');

export const WINDOWS_OUTPUT_VOLUME_SCRIPT = [
    '$dll = $env:AKARI_SYSTEM_VOLUME_DLL',
    "if (-not ('OutputVolumeReader' -as [type])) {",
    ' $loaded = $false',
    ' if (Test-Path -LiteralPath $dll) {',
    '  try { Add-Type -Path $dll -ErrorAction Stop; $loaded = $true } catch { }',
    ' }',
    '',
    ' if (-not $loaded) {',
    '  $tmp = $dll + "." + $PID + ".tmp"',
    '  try {',
    "   $src = @'",
    WINDOWS_OUTPUT_VOLUME_SOURCE,
    "'@",
    '   Add-Type -TypeDefinition $src -OutputAssembly $tmp -ErrorAction Stop',
    '   [void][System.Reflection.Assembly]::Load([System.IO.File]::ReadAllBytes($tmp))',
    '   try { Move-Item -LiteralPath $tmp -Destination $dll -Force -ErrorAction Stop } catch { }',
    '  } finally {',
    '   if (Test-Path -LiteralPath $tmp) { try { Remove-Item -LiteralPath $tmp -ErrorAction Stop } catch { } }',
    '  }',
    ' }',
    '}',
    '',
    '[Console]::Out.WriteLine([OutputVolumeReader]::Read())'
].join('\n') + '\n\n';

interface SystemVolumeReaderDependencies {
    fs?: { existsSync: typeof existsSync; mkdirSync: typeof mkdirSync };
    tmpdir?: typeof tmpdir;
    env?: NodeJS.ProcessEnv;
}

export function createSystemOutputVolumeReader(
    platform: NodeJS.Platform = process.platform,
    execute: typeof execFile = execFile,
    now: () => number = Date.now,
    dependencies: SystemVolumeReaderDependencies = {}
): () => Promise<SystemOutputVolume | undefined> {
    let inFlight: Promise<SystemOutputVolume | undefined> | undefined;
    let cached: { value: SystemOutputVolume | undefined; at: number } | undefined;
    return () => {
        if (platform !== 'win32' && platform !== 'darwin') return Promise.resolve(undefined);
        if (inFlight) return inFlight;
        if (cached && now() - cached.at < 1500) return Promise.resolve(cached.value);
        inFlight = new Promise<SystemOutputVolume | undefined>(resolve => {
            const isWindows = platform === 'win32';
            try {
                const filesystem = dependencies.fs ?? { existsSync, mkdirSync };
                let dllPath: string | undefined;
                if (isWindows) {
                    const directory = join((dependencies.tmpdir ?? tmpdir)(), 'akari-video');
                    filesystem.mkdirSync(directory, { recursive: true });
                    const hash = createHash('sha256').update(WINDOWS_OUTPUT_VOLUME_SOURCE).digest('hex').slice(0, 12);
                    dllPath = join(directory, 'system-volume-' + hash + '.dll');
                }
                const environment = dependencies.env ?? process.env;
                const child = execute(isWindows
                    ? join(environment.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
                    : '/usr/bin/osascript',
                    isWindows ? ['-NoProfile', '-NonInteractive', '-Command', '-']
                        : ['-e', 'get volume settings'],
                    { encoding: 'utf8', timeout: isWindows && dllPath && !filesystem.existsSync(dllPath) ? 10000 : 4000,
                        maxBuffer: 16 * 1024, windowsHide: true,
                        ...(isWindows ? { env: { ...environment, AKARI_SYSTEM_VOLUME_DLL: dllPath } } : {}) },
                    (error, stdout) => {
                        resolve(error ? undefined : isWindows
                            ? parseWindowsOutputVolume(stdout) : parseMacOutputVolume(stdout));
                    });
                if (isWindows) {
                    child.stdin?.on('error', () => {});
                    child.stdin?.end(WINDOWS_OUTPUT_VOLUME_SCRIPT);
                }
            } catch {
                resolve(undefined);
            }
        }).then(value => {
            cached = { value, at: now() };
            inFlight = undefined;
            return value;
        });
        return inFlight;
    };
}

export const readSystemOutputVolume = createSystemOutputVolumeReader();
