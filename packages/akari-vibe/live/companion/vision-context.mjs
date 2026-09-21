// 顔 box [fx,fy,fw,fh] → 人物 box [x,y,w,h]: 顔中心 (cx,cy) を人物の水平中心・上端から
// 15% の位置に置き、h=fh/0.15、w=2.5*fw とする。画面端では中心/15% anchor を保ったまま
// h<=min(cy/0.15,(1-cy)/0.85)、w<=min(2*cx,2*(1-cx)) に縮め、最後に全値を 0〜1 へ丸める。
import fs from 'node:fs';
import path from 'node:path';

export const MAX_VISION_BYTES = 50 * 1024 * 1024;
const TRACK_IOU = 0.3;
const TRACK_GAP_SECONDS = 0.5;
const MIN_SEGMENT_SECONDS = 0.5;

const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = value => Number.isFinite(value);
const unit = value => finite(value) && value >= 0 && value <= 1;
const onlyKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));
const point = value => Array.isArray(value) && value.length === 2 && value.every(unit);
const pointList = value => Array.isArray(value) && value.every(point);

function validLandmarks(value) {
    if (!isObject(value)) return false;
    for (const key of ['left_pupil', 'right_pupil']) if (!point(value[key])) return false;
    for (const key of ['left_eye', 'right_eye', 'outer_lips', 'inner_lips']) if (!pointList(value[key])) return false;
    for (const key of ['left_eyebrow', 'right_eyebrow', 'face_contour']) {
        if (Object.hasOwn(value, key) && !pointList(value[key])) return false;
    }
    return true;
}

function validFaceDetection(value) {
    if (!isObject(value) || !onlyKeys(value, ['box', 'conf', 'landmarks'])) return false;
    if (!Array.isArray(value.box) || value.box.length !== 4 || !value.box.every(unit)) return false;
    const [x, y, w, h] = value.box;
    return w > 0 && h > 0 && x + w <= 1 && y + h <= 1
        && unit(value.conf) && validLandmarks(value.landmarks);
}

function validSource(value) {
    return isObject(value) && onlyKeys(value, ['path', 'duration'])
        && typeof value.path === 'string' && value.path.length > 0
        && (value.duration == null || (finite(value.duration) && value.duration >= 0));
}

function validProvider(value) {
    if (!isObject(value) || !onlyKeys(value, ['name', 'os', 'runtime', 'model_url', 'model_sha256'])) return false;
    if (typeof value.name !== 'string' || value.name.length === 0) return false;
    for (const key of ['os', 'runtime', 'model_url']) {
        if (Object.hasOwn(value, key) && (typeof value[key] !== 'string' || value[key].length === 0)) return false;
    }
    return !Object.hasOwn(value, 'model_sha256')
        || (typeof value.model_sha256 === 'string' && /^[0-9a-f]{64}$/.test(value.model_sha256));
}

/** `vision-tracks.schema.json` の face-landmarks 部分と kind 対応の意味制約を検査する。 */
export function isFaceLandmarks(value) {
    if (!isObject(value) || !onlyKeys(value, ['version', 'kind', 'source', 'sample_fps', 'provider', 'samples'])) return false;
    if (value.version !== 0 || value.kind !== 'face-landmarks' || !validSource(value.source)
        || !finite(value.sample_fps) || value.sample_fps <= 0 || !validProvider(value.provider)
        || !Array.isArray(value.samples)) return false;
    return value.samples.every(sample => isObject(sample) && onlyKeys(sample, ['t', 'detections'])
        && finite(sample.t) && sample.t >= 0 && Array.isArray(sample.detections)
        && sample.detections.every(validFaceDetection));
}

/** stat と実読込後の両方で、1 素材あたり 50MB を越えるファイルを読まない。 */
export function readVisionFile(file) {
    const descriptor = fs.openSync(file, 'r');
    try {
        const size = fs.fstatSync(descriptor).size;
        if (size > MAX_VISION_BYTES) throw new Error('vision sidecar is larger than 50MB');
        const value = Buffer.alloc(size + 1);
        let offset = 0;
        while (offset < value.byteLength) {
            const bytes = fs.readSync(descriptor, value, offset, value.byteLength - offset, null);
            if (bytes === 0) break;
            offset += bytes;
        }
        if (offset > size) throw new Error('vision sidecar changed while reading');
        return value.subarray(0, offset);
    } finally { fs.closeSync(descriptor); }
}

const clamp01 = value => Math.max(0, Math.min(1, value));
const roundUnit = value => clamp01(Math.round(value * 1e9) / 1e9);

export function faceToPersonBox([fx, fy, fw, fh]) {
    const cx = fx + fw / 2;
    const cy = fy + fh / 2;
    const height = Math.min(fh / 0.15, cy / 0.15, (1 - cy) / 0.85, 1);
    const width = Math.min(fw * 2.5, cx * 2, (1 - cx) * 2, 1);
    return [roundUnit(cx - width / 2), roundUnit(cy - height * 0.15), roundUnit(width), roundUnit(height)];
}

function iou(a, b) {
    const left = Math.max(a[0], b[0]);
    const top = Math.max(a[1], b[1]);
    const right = Math.min(a[0] + a[2], b[0] + b[2]);
    const bottom = Math.min(a[1] + a[3], b[1] + b[3]);
    const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
    const union = a[2] * a[3] + b[2] * b[3] - intersection;
    return union > 0 ? intersection / union : 0;
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function medianBox(samples) {
    return [0, 1, 2, 3].map(index => median(samples.map(sample => sample.box[index])));
}

function faceTracks(document) {
    const active = [];
    const finished = [];
    const ordered = document.samples.map((sample, index) => ({ ...sample, index }))
        .sort((left, right) => left.t - right.t || left.index - right.index);
    for (const sample of ordered) {
        for (let index = active.length - 1; index >= 0; index -= 1) {
            if (sample.t - active[index].lastT >= TRACK_GAP_SECONDS) finished.push(...active.splice(index, 1));
        }
        const candidates = [];
        for (let trackIndex = 0; trackIndex < active.length; trackIndex += 1) {
            for (let detectionIndex = 0; detectionIndex < sample.detections.length; detectionIndex += 1) {
                const overlap = iou(active[trackIndex].lastBox, sample.detections[detectionIndex].box);
                if (overlap >= TRACK_IOU) candidates.push({ trackIndex, detectionIndex, overlap });
            }
        }
        candidates.sort((left, right) => right.overlap - left.overlap
            || left.trackIndex - right.trackIndex || left.detectionIndex - right.detectionIndex);
        const usedTracks = new Set();
        const usedDetections = new Set();
        for (const candidate of candidates) {
            if (usedTracks.has(candidate.trackIndex) || usedDetections.has(candidate.detectionIndex)) continue;
            const track = active[candidate.trackIndex];
            const box = sample.detections[candidate.detectionIndex].box;
            track.samples.push({ t: sample.t, box });
            track.lastT = sample.t;
            track.lastBox = box;
            usedTracks.add(candidate.trackIndex);
            usedDetections.add(candidate.detectionIndex);
        }
        for (let index = 0; index < sample.detections.length; index += 1) {
            if (usedDetections.has(index)) continue;
            const box = sample.detections[index].box;
            active.push({ firstT: sample.t, lastT: sample.t, lastBox: box, samples: [{ t: sample.t, box }] });
        }
    }
    finished.push(...active);
    return finished.filter(track => track.lastT - track.firstT >= MIN_SEGMENT_SECONDS)
        .sort((left, right) => left.firstT - right.firstT
            || medianBox(left.samples)[0] - medianBox(right.samples)[0]);
}

function locationLabel(box) {
    const center = box[0] + box[2] / 2;
    return center < 1 / 3 ? '左の人' : center > 2 / 3 ? '右の人' : '真ん中の人';
}

const rangesOverlap = (left, right) => left[0] < right[1] && right[0] < left[1];

function markForeground(rows) {
    return rows.map(row => {
        const group = rows.filter(candidate => candidate.src === row.src && candidate.label === row.label
            && rangesOverlap(candidate.srcRange, row.srcRange));
        if (group.length < 2) return row;
        const front = [...group].sort((left, right) => right.box[2] * right.box[3] - left.box[2] * left.box[3]
            || left.id.localeCompare(right.id))[0];
        return front.id === row.id ? { ...row, label: `${row.label}（手前）` } : row;
    });
}

function relativeSourcePath(location, sourcePath) {
    if (!isObject(location) || typeof location.rootFsPath !== 'string' || !location.rootFsPath
        || typeof location.editPath !== 'string' || !location.editPath
        || typeof sourcePath !== 'string' || !sourcePath || path.isAbsolute(location.editPath) || path.isAbsolute(sourcePath)) return null;
    const root = path.resolve(location.rootFsPath);
    const editFile = path.resolve(root, location.editPath);
    const sourceFile = path.resolve(path.dirname(editFile), sourcePath);
    const relative = path.relative(root, sourceFile);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null;
    return relative;
}

/** edit.json 全文と bridge の location から、手元専用の人物文脈を作る。素材単位の失敗は空として扱う。 */
export function deriveVisionContext(editSource, location, readFile = readVisionFile) {
    let edit;
    try { edit = typeof editSource === 'string' ? JSON.parse(editSource) : editSource; }
    catch { return []; }
    if (!isObject(edit) || !Array.isArray(edit.sources) || !location) return [];
    const rows = [];
    let nextId = 1;
    for (const source of edit.sources) {
        if (!isObject(source) || typeof source.id !== 'string') continue;
        const relative = relativeSourcePath(location, source.path);
        if (!relative) continue;
        const sidecar = path.join(path.resolve(location.rootFsPath), '.akari', 'sidecars', `${relative}.analysis`, 'vision', 'face-landmarks.json');
        try {
            const raw = readFile(sidecar, MAX_VISION_BYTES);
            if (Buffer.byteLength(raw) > MAX_VISION_BYTES) continue;
            const document = JSON.parse(String(raw));
            if (!isFaceLandmarks(document)) continue;
            for (const track of faceTracks(document)) {
                const box = faceToPersonBox(medianBox(track.samples));
                rows.push({ id: `person_${nextId++}`, srcRange: [track.firstT, track.lastT], box,
                    src: source.id, label: locationLabel(box) });
            }
        } catch { /* sidecar 無し・読込不能・壊れた JSON・schema 違反は、その素材の人物なし */ }
    }
    return markForeground(rows);
}
