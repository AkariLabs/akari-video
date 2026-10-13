import test from 'node:test';
import assert from 'node:assert/strict';
import {
    LIBRARY_DRAG_MIME,
    MATERIAL_DRAG_MIME,
    isDelegatedDropInput,
    isDelegatedLibraryDropInput
} from '../lib/common/delegated-drop.js';

// task 2026-09-08-timeline-file-drop 指示14 / issue #63。
// 委譲判定は「dropzone の内側か」だけを見ていたため、OS からのファイルドロップまで
// 委譲され、委譲先（自 MIME 以外を無視して return する）との間で落ちて無反応になっていた。
// (b) が本 issue の核 — Files だけのドロップは委譲せず、グローバル経路が拾う。

test('(a) 内部 MIME あり + dropzone 内 → true（素材カード D&D は委譲する）', () => {
    assert.equal(isDelegatedDropInput({
        insideDropzone: true, types: [MATERIAL_DRAG_MIME]
    }), true);
    assert.equal(isDelegatedDropInput({
        insideDropzone: true, types: [LIBRARY_DRAG_MIME]
    }), true);
});

test('(b) Files のみ + dropzone 内 → false（OS ファイルドロップはグローバル経路が拾う）', () => {
    assert.equal(isDelegatedDropInput({
        insideDropzone: true, types: ['Files']
    }), false);
});

test('(c) dropzone 外 → false', () => {
    assert.equal(isDelegatedDropInput({
        insideDropzone: false, types: ['Files']
    }), false);
    assert.equal(isDelegatedDropInput({
        insideDropzone: false, types: [] }), false);
});

test('(d) 内部 MIME あり + dropzone 外 → false', () => {
    assert.equal(isDelegatedDropInput({
        insideDropzone: false, types: [MATERIAL_DRAG_MIME]
    }), false);
});

test('Files と内部 MIME が同時に載っていれば委譲する（内部ドラッグの実測形）', () => {
    assert.equal(isDelegatedDropInput({
        insideDropzone: true, types: ['Files', MATERIAL_DRAG_MIME]
    }), true);
});

// 判定は DataTransfer.types だけを見る。OS からのドロップは動画 1 本でも
// 動画 + 音 + フォントの混在でも types が ['Files'] で、判定への入力は同じ。
// ライブラリ面ではファイルの種類を問わず、グローバル経路が横取りせずパネルに委譲する。
test('ライブラリ面の OS ファイルは種類を問わずパネルに委譲する（動画だけ・混在は同じ入力）', () => {
    assert.equal(isDelegatedLibraryDropInput({
        insideDropzone: true, insideLibrarySurface: true, types: ['Files']
    }), true);
});

test('プロジェクト面とライブラリパネル外の動画はグローバル経路に残す', () => {
    assert.equal(isDelegatedLibraryDropInput({
        insideDropzone: true, insideLibrarySurface: false, types: ['Files']
    }), false);
    assert.equal(isDelegatedLibraryDropInput({
        insideDropzone: false, insideLibrarySurface: false, types: ['Files']
    }), false);
});

test('内部ドラッグの委譲はライブラリ面でも従来どおり', () => {
    assert.equal(isDelegatedLibraryDropInput({
        insideDropzone: true, insideLibrarySurface: true, types: ['Files', MATERIAL_DRAG_MIME]
    }), true);
    assert.equal(isDelegatedLibraryDropInput({
        insideDropzone: true, insideLibrarySurface: false, types: [LIBRARY_DRAG_MIME]
    }), true);
});
