import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
    isAppMarkerOk,
    isPartnerConnected,
    isProjectConnectionsOk
} from '../lib/common/connection-status.js';
import {
    checkPartnerConnection,
    PartnerConnectionTransitionDetector
} from '../lib/common/partner-connection-watch.js';

// 接続ガイドダイアログ（task 2026-08-06-partner-connect-popup）の接続成立検知。
// ホーム v2 の SSOT（connections.json の akari-cloud provider の doctor.status /
// アプリ単位マーカーの status）と同じ判定を、fs モック（未接続→接続の 2 ファイルの
// 有無・値の変化）で検証する。

function connectionsJson(status) {
    return JSON.stringify({ providers: [{ id: 'akari-cloud', doctor: { status } }] });
}

test('isProjectConnectionsOk: ファイル無し（undefined）は未接続', () => {
    assert.equal(isProjectConnectionsOk(undefined), false);
});

test('isProjectConnectionsOk: 壊れた JSON は未接続', () => {
    assert.equal(isProjectConnectionsOk('{ これは JSON ではない'), false);
});

test('isProjectConnectionsOk: akari-cloud エントリが無ければ未接続', () => {
    const raw = JSON.stringify({ providers: [{ id: 'voicevox', doctor: { status: 'ok' } }] });
    assert.equal(isProjectConnectionsOk(raw), false);
});

test('isProjectConnectionsOk: doctor.status が ok 以外なら未接続', () => {
    assert.equal(isProjectConnectionsOk(connectionsJson('unchecked')), false);
});

test('isProjectConnectionsOk: doctor.status === ok で接続済み', () => {
    assert.equal(isProjectConnectionsOk(connectionsJson('ok')), true);
});

test('isAppMarkerOk: ファイル無し（undefined）は未接続', () => {
    assert.equal(isAppMarkerOk(undefined), false);
});

test('isAppMarkerOk: 壊れた JSON は未接続', () => {
    assert.equal(isAppMarkerOk('not json'), false);
});

test('isAppMarkerOk: status が ok 以外は未接続', () => {
    assert.equal(isAppMarkerOk(JSON.stringify({ status: 'pending' })), false);
});

test('isAppMarkerOk: status === ok で接続済み', () => {
    assert.equal(isAppMarkerOk(JSON.stringify({ status: 'ok' })), true);
});

test('isPartnerConnected: プロジェクト/アプリのどちらか一方が ok なら接続済み（ホームの readConnected() と同じ OR 判定）', () => {
    assert.equal(
        isPartnerConnected({ projectConnectionsRaw: undefined, appMarkerRaw: JSON.stringify({ status: 'ok' }) }),
        true
    );
    assert.equal(
        isPartnerConnected({ projectConnectionsRaw: connectionsJson('ok'), appMarkerRaw: undefined }),
        true
    );
    assert.equal(
        isPartnerConnected({ projectConnectionsRaw: undefined, appMarkerRaw: undefined }),
        false
    );
});

test('checkPartnerConnection: 実ファイル(fs) 経由でも判定できる', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'akari-partner-watch-'));
    const connectionsPath = path.join(dir, 'connections.json');
    const markerPath = path.join(dir, 'partner-connection.json');
    const access = {
        readProjectConnections: async () => {
            try {
                return await readFile(connectionsPath, 'utf8');
            } catch {
                return undefined;
            }
        },
        readAppMarker: async () => {
            try {
                return await readFile(markerPath, 'utf8');
            } catch {
                return undefined;
            }
        }
    };

    assert.equal(await checkPartnerConnection(access), 'disconnected');

    await writeFile(connectionsPath, connectionsJson('ok'), 'utf8');
    assert.equal(await checkPartnerConnection(access), 'connected');

    await rm(dir, { recursive: true, force: true });
});

test('PartnerConnectionTransitionDetector: 未接続 → 接続のタイミングだけ 1 回発火する（フラッピングなし）', () => {
    const detector = new PartnerConnectionTransitionDetector();
    assert.equal(detector.ingest('disconnected'), false);
    assert.equal(detector.ingest('disconnected'), false);
    assert.equal(detector.ingest('connected'), true);
    assert.equal(detector.ingest('connected'), false);
    assert.equal(detector.ingest('disconnected'), false);
    assert.equal(detector.ingest('connected'), false);
    assert.equal(detector.state, 'connected');
});

test('PartnerConnectionTransitionDetector: ポーリングをシミュレートした一連の流れでダイアログの状態遷移相当が 1 回だけ発火する', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'akari-partner-watch-'));
    const connectionsPath = path.join(dir, 'connections.json');
    const access = {
        readProjectConnections: async () => {
            try {
                return await readFile(connectionsPath, 'utf8');
            } catch {
                return undefined;
            }
        },
        readAppMarker: async () => undefined
    };
    const detector = new PartnerConnectionTransitionDetector();
    const transitions = [];

    // tick 1: まだ何も無い（CLI 準備中相当）。
    transitions.push(detector.ingest(await checkPartnerConnection(access)));
    // tick 2: PTY 接続成立 → connections.json が ok に倒る（attachTerminal() の
    // markCloudConnectionOk() 相当の副作用）。
    await writeFile(connectionsPath, connectionsJson('ok'), 'utf8');
    transitions.push(detector.ingest(await checkPartnerConnection(access)));
    // tick 3: 接続済みのまま（再発火しないこと）。
    transitions.push(detector.ingest(await checkPartnerConnection(access)));

    assert.deepEqual(transitions, [false, true, false]);

    await rm(dir, { recursive: true, force: true });
});
