import { createHash } from "node:crypto";

export function canonicalJson(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON accepts finite numbers only");
    return JSON.stringify(Object.is(value, -0) ? 0 : value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(codePointCompare)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("canonical JSON rejects undefined");
  return serialized;
}

export function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`, "utf8");
}

export function canonicalBytesBounded(value, maximumBytes) {
  const chunks = [];
  let committedBytes = 0;
  let pending = "";
  let pendingBytes = 0;
  const flush = () => {
    if (pendingBytes === 0) return;
    chunks.push(Buffer.from(pending, "utf8"));
    committedBytes += pendingBytes;
    pending = "";
    pendingBytes = 0;
  };
  const emit = (text) => {
    const bytes = Buffer.byteLength(text, "utf8");
    if (committedBytes + pendingBytes + bytes + 1 > maximumBytes) throw new RangeError("canonical byte limit exceeded");
    if (bytes >= 65_536) {
      flush();
      chunks.push(Buffer.from(text, "utf8"));
      committedBytes += bytes;
    } else {
      pending += text;
      pendingBytes += bytes;
      if (pendingBytes >= 65_536) flush();
    }
  };
  const write = (current) => {
    if (typeof current === "number") {
      if (!Number.isFinite(current)) throw new TypeError("canonical JSON accepts finite numbers only");
      emit(JSON.stringify(Object.is(current, -0) ? 0 : current));
      return;
    }
    if (Array.isArray(current)) {
      emit("[");
      current.forEach((entry, index) => {
        if (index > 0) emit(",");
        write(entry);
      });
      emit("]");
      return;
    }
    if (current !== null && typeof current === "object") {
      emit("{");
      Object.keys(current).sort(codePointCompare).forEach((key, index) => {
        if (index > 0) emit(",");
        emit(JSON.stringify(key));
        emit(":");
        write(current[key]);
      });
      emit("}");
      return;
    }
    const serialized = JSON.stringify(current);
    if (serialized === undefined) throw new TypeError("canonical JSON rejects undefined");
    emit(serialized);
  };
  write(value);
  flush();
  chunks.push(Buffer.from("\n"));
  return Buffer.concat(chunks, committedBytes + 1);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function round6(value) {
  const result = Math.round(Number(value) * 1e6) / 1e6;
  return Object.is(result, -0) ? 0 : result;
}

export function codePointCompare(left, right) {
  let leftIndex = 0;
  let rightIndex = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    const leftPoint = left.codePointAt(leftIndex);
    const rightPoint = right.codePointAt(rightIndex);
    if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
    leftIndex += leftPoint > 0xffff ? 2 : 1;
    rightIndex += rightPoint > 0xffff ? 2 : 1;
  }
  return leftIndex === left.length ? (rightIndex === right.length ? 0 : -1) : 1;
}

export function compareNumbers(left, right) {
  return left - right;
}
