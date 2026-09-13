"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readGenerationMeta = readGenerationMeta;
exports.findGenerationMetaBySha = findGenerationMetaBySha;
const node_crypto_1 = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const generation_meta_1 = require("./generation-meta");
function readGenerationMeta(options) {
    const sourcePath = resolveInsideProject(options.projectRoot, options.sourcePath);
    const sidecarPath = (0, generation_meta_1.sidecarPathFor)(sourcePath);
    if (!fs.existsSync(sidecarPath)) {
        return { state: 'none', meta: null, sidecarPath, binding: null };
    }
    const meta = parseMeta(sidecarPath);
    const expected = bindingSha(meta);
    let binding = null;
    let state = (0, generation_meta_1.resolveGenerationState)(meta, options.now);
    if (expected) {
        const actualSha256 = fs.existsSync(sourcePath) && fs.statSync(sourcePath).isFile()
            ? sha256File(sourcePath)
            : null;
        binding = {
            expectedSha256: expected.sha256,
            actualSha256,
            matches: actualSha256 === expected.sha256,
            source: expected.source,
        };
        if (!binding.matches)
            state = 'orphan';
    }
    return { state, meta, sidecarPath, binding };
}
function findGenerationMetaBySha(options) {
    const generatedRoot = resolveInsideProject(options.projectRoot, 'assets/generated');
    if (!fs.existsSync(generatedRoot) || !fs.statSync(generatedRoot).isDirectory())
        return null;
    for (const sidecarPath of generationSidecars(generatedRoot)) {
        const meta = parseMeta(sidecarPath);
        const expected = bindingSha(meta);
        if (expected?.sha256 === options.sha256)
            return meta;
    }
    return null;
}
function bindingSha(meta) {
    if (meta.status === 'done' && typeof meta.result?.sha256 === 'string') {
        return { sha256: meta.result.sha256, source: 'result' };
    }
    if ((meta.kind === 'still' || meta.status === 'planned') && typeof meta.inputs?.first_frame?.sha256 === 'string') {
        return { sha256: meta.inputs.first_frame.sha256, source: 'first_frame' };
    }
    return null;
}
function generationSidecars(directory) {
    const found = [];
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory())
            found.push(...generationSidecars(absolute));
        else if (entry.isFile() && entry.name.endsWith('.meta.json'))
            found.push(absolute);
    }
    return found.sort();
}
function resolveInsideProject(projectRoot, candidate) {
    if (!candidate)
        throw new Error('sourcePath は空でないパスである必要があります。');
    const root = path.resolve(projectRoot);
    const absolute = path.isAbsolute(candidate) ? path.resolve(candidate) : path.resolve(root, candidate);
    const relative = path.relative(root, absolute);
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new Error(`projectRoot 外のパスは扱えません: ${candidate}`);
    }
    if (fs.existsSync(absolute)) {
        const realRoot = fs.realpathSync(root);
        const realPath = fs.realpathSync(absolute);
        const realRelative = path.relative(realRoot, realPath);
        if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
            throw new Error(`projectRoot 外を指すパスは扱えません: ${candidate}`);
        }
    }
    return absolute;
}
function parseMeta(sidecarPath) {
    let value;
    try {
        value = JSON.parse(fs.readFileSync(sidecarPath, 'utf8'));
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`生成サイドカーを読めません: ${sidecarPath}: ${message}`);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`生成サイドカーのルートは object である必要があります: ${sidecarPath}`);
    }
    return value;
}
function sha256File(filePath) {
    return (0, node_crypto_1.createHash)('sha256').update(fs.readFileSync(filePath)).digest('hex');
}
