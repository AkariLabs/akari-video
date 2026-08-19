"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LegacyEditVersionError = void 0;
class LegacyEditVersionError extends Error {
    constructor(version) {
        super(`このプロジェクトは古い形式です（edit.json version ${version}）。`
            + '`akari migrate <dir>` で変換してから開いてください。'
            + '将来本体から変換器が外れた後は `npx akari-migrate@<版> <dir>` を使います。');
        this.version = version;
        this.name = 'LegacyEditVersionError';
    }
}
exports.LegacyEditVersionError = LegacyEditVersionError;
