var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// ../../node_modules/@webav/mp4box.js/dist/mp4box.all.js
var require_mp4box_all = __commonJS({
  "../../node_modules/@webav/mp4box.js/dist/mp4box.all.js"(exports) {
    var Log = /* @__PURE__ */ function() {
      var start = /* @__PURE__ */ new Date();
      var LOG_LEVEL_ERROR = 4;
      var LOG_LEVEL_WARNING = 3;
      var LOG_LEVEL_INFO = 2;
      var LOG_LEVEL_DEBUG = 1;
      var log_level = LOG_LEVEL_ERROR;
      var logObject = {
        setLogLevel: function(level) {
          if (level == this.debug) log_level = LOG_LEVEL_DEBUG;
          else if (level == this.info) log_level = LOG_LEVEL_INFO;
          else if (level == this.warn) log_level = LOG_LEVEL_WARNING;
          else if (level == this.error) log_level = LOG_LEVEL_ERROR;
          else log_level = LOG_LEVEL_ERROR;
        },
        debug: function(module2, msg) {
          if (console.debug === void 0) {
            console.debug = console.log;
          }
          if (LOG_LEVEL_DEBUG >= log_level) {
            console.debug("[" + Log.getDurationString(/* @__PURE__ */ new Date() - start, 1e3) + "]", "[" + module2 + "]", msg);
          }
        },
        log: function(module2, msg) {
          this.debug(module2.msg);
        },
        info: function(module2, msg) {
          if (LOG_LEVEL_INFO >= log_level) {
            console.info("[" + Log.getDurationString(/* @__PURE__ */ new Date() - start, 1e3) + "]", "[" + module2 + "]", msg);
          }
        },
        warn: function(module2, msg) {
          if (LOG_LEVEL_WARNING >= log_level) {
            console.warn("[" + Log.getDurationString(/* @__PURE__ */ new Date() - start, 1e3) + "]", "[" + module2 + "]", msg);
          }
        },
        error: function(module2, msg) {
          if (LOG_LEVEL_ERROR >= log_level) {
            console.error("[" + Log.getDurationString(/* @__PURE__ */ new Date() - start, 1e3) + "]", "[" + module2 + "]", msg);
          }
        }
      };
      return logObject;
    }();
    Log.getDurationString = function(duration, _timescale) {
      var neg;
      function pad(number, length) {
        var str = "" + number;
        var a = str.split(".");
        while (a[0].length < length) {
          a[0] = "0" + a[0];
        }
        return a.join(".");
      }
      if (duration < 0) {
        neg = true;
        duration = -duration;
      } else {
        neg = false;
      }
      var timescale = _timescale || 1;
      var duration_sec = duration / timescale;
      var hours = Math.floor(duration_sec / 3600);
      duration_sec -= hours * 3600;
      var minutes = Math.floor(duration_sec / 60);
      duration_sec -= minutes * 60;
      var msec = duration_sec * 1e3;
      duration_sec = Math.floor(duration_sec);
      msec -= duration_sec * 1e3;
      msec = Math.floor(msec);
      return (neg ? "-" : "") + hours + ":" + pad(minutes, 2) + ":" + pad(duration_sec, 2) + "." + pad(msec, 3);
    };
    Log.printRanges = function(ranges) {
      var length = ranges.length;
      if (length > 0) {
        var str = "";
        for (var i2 = 0; i2 < length; i2++) {
          if (i2 > 0) str += ",";
          str += "[" + Log.getDurationString(ranges.start(i2)) + "," + Log.getDurationString(ranges.end(i2)) + "]";
        }
        return str;
      } else {
        return "(empty)";
      }
    };
    if (typeof exports !== "undefined") {
      exports.Log = Log;
    }
    var MP4BoxStream = function(arrayBuffer) {
      if (arrayBuffer instanceof ArrayBuffer) {
        this.buffer = arrayBuffer;
        this.dataview = new DataView(arrayBuffer);
      } else {
        throw "Needs an array buffer";
      }
      this.position = 0;
    };
    MP4BoxStream.prototype.getPosition = function() {
      return this.position;
    };
    MP4BoxStream.prototype.getEndPosition = function() {
      return this.buffer.byteLength;
    };
    MP4BoxStream.prototype.getLength = function() {
      return this.buffer.byteLength;
    };
    MP4BoxStream.prototype.seek = function(pos) {
      var npos = Math.max(0, Math.min(this.buffer.byteLength, pos));
      this.position = isNaN(npos) || !isFinite(npos) ? 0 : npos;
      return true;
    };
    MP4BoxStream.prototype.isEos = function() {
      return this.getPosition() >= this.getEndPosition();
    };
    MP4BoxStream.prototype.readAnyInt = function(size, signed) {
      var res = 0;
      if (this.position + size <= this.buffer.byteLength) {
        switch (size) {
          case 1:
            if (signed) {
              res = this.dataview.getInt8(this.position);
            } else {
              res = this.dataview.getUint8(this.position);
            }
            break;
          case 2:
            if (signed) {
              res = this.dataview.getInt16(this.position);
            } else {
              res = this.dataview.getUint16(this.position);
            }
            break;
          case 3:
            if (signed) {
              throw "No method for reading signed 24 bits values";
            } else {
              res = this.dataview.getUint8(this.position) << 16;
              res |= this.dataview.getUint8(this.position + 1) << 8;
              res |= this.dataview.getUint8(this.position + 2);
            }
            break;
          case 4:
            if (signed) {
              res = this.dataview.getInt32(this.position);
            } else {
              res = this.dataview.getUint32(this.position);
            }
            break;
          case 8:
            if (signed) {
              throw "No method for reading signed 64 bits values";
            } else {
              res = this.dataview.getUint32(this.position) << 32;
              res |= this.dataview.getUint32(this.position + 4);
            }
            break;
          default:
            throw "readInt method not implemented for size: " + size;
        }
        this.position += size;
        return res;
      } else {
        throw "Not enough bytes in buffer";
      }
    };
    MP4BoxStream.prototype.readUint8 = function() {
      return this.readAnyInt(1, false);
    };
    MP4BoxStream.prototype.readUint16 = function() {
      return this.readAnyInt(2, false);
    };
    MP4BoxStream.prototype.readUint24 = function() {
      return this.readAnyInt(3, false);
    };
    MP4BoxStream.prototype.readUint32 = function() {
      return this.readAnyInt(4, false);
    };
    MP4BoxStream.prototype.readUint64 = function() {
      return this.readAnyInt(8, false);
    };
    MP4BoxStream.prototype.readString = function(length) {
      if (this.position + length <= this.buffer.byteLength) {
        var s = "";
        for (var i2 = 0; i2 < length; i2++) {
          s += String.fromCharCode(this.readUint8());
        }
        return s;
      } else {
        throw "Not enough bytes in buffer";
      }
    };
    MP4BoxStream.prototype.readCString = function() {
      var arr = [];
      while (true) {
        var b = this.readUint8();
        if (b !== 0) {
          arr.push(b);
        } else {
          break;
        }
      }
      return String.fromCharCode.apply(null, arr);
    };
    MP4BoxStream.prototype.readInt8 = function() {
      return this.readAnyInt(1, true);
    };
    MP4BoxStream.prototype.readInt16 = function() {
      return this.readAnyInt(2, true);
    };
    MP4BoxStream.prototype.readInt32 = function() {
      return this.readAnyInt(4, true);
    };
    MP4BoxStream.prototype.readInt64 = function() {
      return this.readAnyInt(8, false);
    };
    MP4BoxStream.prototype.readUint8Array = function(length) {
      var arr = new Uint8Array(length);
      for (var i2 = 0; i2 < length; i2++) {
        arr[i2] = this.readUint8();
      }
      return arr;
    };
    MP4BoxStream.prototype.readInt16Array = function(length) {
      var arr = new Int16Array(length);
      for (var i2 = 0; i2 < length; i2++) {
        arr[i2] = this.readInt16();
      }
      return arr;
    };
    MP4BoxStream.prototype.readUint16Array = function(length) {
      var arr = new Int16Array(length);
      for (var i2 = 0; i2 < length; i2++) {
        arr[i2] = this.readUint16();
      }
      return arr;
    };
    MP4BoxStream.prototype.readUint32Array = function(length) {
      var arr = new Uint32Array(length);
      for (var i2 = 0; i2 < length; i2++) {
        arr[i2] = this.readUint32();
      }
      return arr;
    };
    MP4BoxStream.prototype.readInt32Array = function(length) {
      var arr = new Int32Array(length);
      for (var i2 = 0; i2 < length; i2++) {
        arr[i2] = this.readInt32();
      }
      return arr;
    };
    if (typeof exports !== "undefined") {
      exports.MP4BoxStream = MP4BoxStream;
    }
    var DataStream = function(arrayBuffer, byteOffset, endianness) {
      this._byteOffset = byteOffset || 0;
      if (arrayBuffer instanceof ArrayBuffer) {
        this.buffer = arrayBuffer;
      } else if (typeof arrayBuffer == "object") {
        this.dataView = arrayBuffer;
        if (byteOffset) {
          this._byteOffset += byteOffset;
        }
      } else {
        this.buffer = new ArrayBuffer(arrayBuffer || 0);
      }
      this.position = 0;
      this.endianness = endianness == null ? DataStream.LITTLE_ENDIAN : endianness;
    };
    DataStream.prototype = {};
    DataStream.prototype.getPosition = function() {
      return this.position;
    };
    DataStream.prototype._realloc = function(extra) {
      if (!this._dynamicSize) {
        return;
      }
      var req = this._byteOffset + this.position + extra;
      var blen = this._buffer.byteLength;
      if (req <= blen) {
        if (req > this._byteLength) {
          this._byteLength = req;
        }
        return;
      }
      if (blen < 1) {
        blen = 1;
      }
      while (req > blen) {
        blen *= 2;
      }
      var buf = new ArrayBuffer(blen);
      var src = new Uint8Array(this._buffer);
      var dst = new Uint8Array(buf, 0, src.length);
      dst.set(src);
      this.buffer = buf;
      this._byteLength = req;
    };
    DataStream.prototype._trimAlloc = function() {
      if (this._byteLength == this._buffer.byteLength) {
        return;
      }
      var buf = new ArrayBuffer(this._byteLength);
      var dst = new Uint8Array(buf);
      var src = new Uint8Array(this._buffer, 0, dst.length);
      dst.set(src);
      this.buffer = buf;
    };
    DataStream.BIG_ENDIAN = false;
    DataStream.LITTLE_ENDIAN = true;
    DataStream.prototype._byteLength = 0;
    Object.defineProperty(
      DataStream.prototype,
      "byteLength",
      { get: function() {
        return this._byteLength - this._byteOffset;
      } }
    );
    Object.defineProperty(
      DataStream.prototype,
      "buffer",
      {
        get: function() {
          this._trimAlloc();
          return this._buffer;
        },
        set: function(v2) {
          this._buffer = v2;
          this._dataView = new DataView(this._buffer, this._byteOffset);
          this._byteLength = this._buffer.byteLength;
        }
      }
    );
    Object.defineProperty(
      DataStream.prototype,
      "byteOffset",
      {
        get: function() {
          return this._byteOffset;
        },
        set: function(v2) {
          this._byteOffset = v2;
          this._dataView = new DataView(this._buffer, this._byteOffset);
          this._byteLength = this._buffer.byteLength;
        }
      }
    );
    Object.defineProperty(
      DataStream.prototype,
      "dataView",
      {
        get: function() {
          return this._dataView;
        },
        set: function(v2) {
          this._byteOffset = v2.byteOffset;
          this._buffer = v2.buffer;
          this._dataView = new DataView(this._buffer, this._byteOffset);
          this._byteLength = this._byteOffset + v2.byteLength;
        }
      }
    );
    DataStream.prototype.seek = function(pos) {
      var npos = Math.max(0, Math.min(this.byteLength, pos));
      this.position = isNaN(npos) || !isFinite(npos) ? 0 : npos;
    };
    DataStream.prototype.isEof = function() {
      return this.position >= this._byteLength;
    };
    DataStream.prototype.mapUint8Array = function(length) {
      this._realloc(length * 1);
      var arr = new Uint8Array(this._buffer, this.byteOffset + this.position, length);
      this.position += length * 1;
      return arr;
    };
    DataStream.prototype.readInt32Array = function(length, e) {
      length = length == null ? this.byteLength - this.position / 4 : length;
      var arr = new Int32Array(length);
      DataStream.memcpy(
        arr.buffer,
        0,
        this.buffer,
        this.byteOffset + this.position,
        length * arr.BYTES_PER_ELEMENT
      );
      DataStream.arrayToNative(arr, e == null ? this.endianness : e);
      this.position += arr.byteLength;
      return arr;
    };
    DataStream.prototype.readInt16Array = function(length, e) {
      length = length == null ? this.byteLength - this.position / 2 : length;
      var arr = new Int16Array(length);
      DataStream.memcpy(
        arr.buffer,
        0,
        this.buffer,
        this.byteOffset + this.position,
        length * arr.BYTES_PER_ELEMENT
      );
      DataStream.arrayToNative(arr, e == null ? this.endianness : e);
      this.position += arr.byteLength;
      return arr;
    };
    DataStream.prototype.readInt8Array = function(length) {
      length = length == null ? this.byteLength - this.position : length;
      var arr = new Int8Array(length);
      DataStream.memcpy(
        arr.buffer,
        0,
        this.buffer,
        this.byteOffset + this.position,
        length * arr.BYTES_PER_ELEMENT
      );
      this.position += arr.byteLength;
      return arr;
    };
    DataStream.prototype.readUint32Array = function(length, e) {
      length = length == null ? this.byteLength - this.position / 4 : length;
      var arr = new Uint32Array(length);
      DataStream.memcpy(
        arr.buffer,
        0,
        this.buffer,
        this.byteOffset + this.position,
        length * arr.BYTES_PER_ELEMENT
      );
      DataStream.arrayToNative(arr, e == null ? this.endianness : e);
      this.position += arr.byteLength;
      return arr;
    };
    DataStream.prototype.readUint16Array = function(length, e) {
      length = length == null ? this.byteLength - this.position / 2 : length;
      var arr = new Uint16Array(length);
      DataStream.memcpy(
        arr.buffer,
        0,
        this.buffer,
        this.byteOffset + this.position,
        length * arr.BYTES_PER_ELEMENT
      );
      DataStream.arrayToNative(arr, e == null ? this.endianness : e);
      this.position += arr.byteLength;
      return arr;
    };
    DataStream.prototype.readUint8Array = function(length) {
      length = length == null ? this.byteLength - this.position : length;
      var arr = new Uint8Array(length);
      DataStream.memcpy(
        arr.buffer,
        0,
        this.buffer,
        this.byteOffset + this.position,
        length * arr.BYTES_PER_ELEMENT
      );
      this.position += arr.byteLength;
      return arr;
    };
    DataStream.prototype.readFloat64Array = function(length, e) {
      length = length == null ? this.byteLength - this.position / 8 : length;
      var arr = new Float64Array(length);
      DataStream.memcpy(
        arr.buffer,
        0,
        this.buffer,
        this.byteOffset + this.position,
        length * arr.BYTES_PER_ELEMENT
      );
      DataStream.arrayToNative(arr, e == null ? this.endianness : e);
      this.position += arr.byteLength;
      return arr;
    };
    DataStream.prototype.readFloat32Array = function(length, e) {
      length = length == null ? this.byteLength - this.position / 4 : length;
      var arr = new Float32Array(length);
      DataStream.memcpy(
        arr.buffer,
        0,
        this.buffer,
        this.byteOffset + this.position,
        length * arr.BYTES_PER_ELEMENT
      );
      DataStream.arrayToNative(arr, e == null ? this.endianness : e);
      this.position += arr.byteLength;
      return arr;
    };
    DataStream.prototype.readInt32 = function(e) {
      var v2 = this._dataView.getInt32(this.position, e == null ? this.endianness : e);
      this.position += 4;
      return v2;
    };
    DataStream.prototype.readInt16 = function(e) {
      var v2 = this._dataView.getInt16(this.position, e == null ? this.endianness : e);
      this.position += 2;
      return v2;
    };
    DataStream.prototype.readInt8 = function() {
      var v2 = this._dataView.getInt8(this.position);
      this.position += 1;
      return v2;
    };
    DataStream.prototype.readUint32 = function(e) {
      var v2 = this._dataView.getUint32(this.position, e == null ? this.endianness : e);
      this.position += 4;
      return v2;
    };
    DataStream.prototype.readUint16 = function(e) {
      var v2 = this._dataView.getUint16(this.position, e == null ? this.endianness : e);
      this.position += 2;
      return v2;
    };
    DataStream.prototype.readUint8 = function() {
      var v2 = this._dataView.getUint8(this.position);
      this.position += 1;
      return v2;
    };
    DataStream.prototype.readFloat32 = function(e) {
      var v2 = this._dataView.getFloat32(this.position, e == null ? this.endianness : e);
      this.position += 4;
      return v2;
    };
    DataStream.prototype.readFloat64 = function(e) {
      var v2 = this._dataView.getFloat64(this.position, e == null ? this.endianness : e);
      this.position += 8;
      return v2;
    };
    DataStream.endianness = new Int8Array(new Int16Array([1]).buffer)[0] > 0;
    DataStream.memcpy = function(dst, dstOffset, src, srcOffset, byteLength) {
      var dstU8 = new Uint8Array(dst, dstOffset, byteLength);
      var srcU8 = new Uint8Array(src, srcOffset, byteLength);
      dstU8.set(srcU8);
    };
    DataStream.arrayToNative = function(array, arrayIsLittleEndian) {
      if (arrayIsLittleEndian == this.endianness) {
        return array;
      } else {
        return this.flipArrayEndianness(array);
      }
    };
    DataStream.nativeToEndian = function(array, littleEndian) {
      if (this.endianness == littleEndian) {
        return array;
      } else {
        return this.flipArrayEndianness(array);
      }
    };
    DataStream.flipArrayEndianness = function(array) {
      var u8 = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
      for (var i2 = 0; i2 < array.byteLength; i2 += array.BYTES_PER_ELEMENT) {
        for (var j2 = i2 + array.BYTES_PER_ELEMENT - 1, k2 = i2; j2 > k2; j2--, k2++) {
          var tmp = u8[k2];
          u8[k2] = u8[j2];
          u8[j2] = tmp;
        }
      }
      return array;
    };
    DataStream.prototype.failurePosition = 0;
    String.fromCharCodeUint8 = function(uint8arr) {
      var arr = [];
      for (var i2 = 0; i2 < uint8arr.length; i2++) {
        arr[i2] = uint8arr[i2];
      }
      return String.fromCharCode.apply(null, arr);
    };
    DataStream.prototype.readString = function(length, encoding) {
      if (encoding == null || encoding == "ASCII") {
        return String.fromCharCodeUint8.apply(null, [this.mapUint8Array(length == null ? this.byteLength - this.position : length)]);
      } else {
        return new TextDecoder(encoding).decode(this.mapUint8Array(length));
      }
    };
    DataStream.prototype.readCString = function(length) {
      var blen = this.byteLength - this.position;
      var u8 = new Uint8Array(this._buffer, this._byteOffset + this.position);
      var len = blen;
      if (length != null) {
        len = Math.min(length, blen);
      }
      for (var i2 = 0; i2 < len && u8[i2] !== 0; i2++) ;
      var s = String.fromCharCodeUint8.apply(null, [this.mapUint8Array(i2)]);
      if (length != null) {
        this.position += len - i2;
      } else if (i2 != blen) {
        this.position += 1;
      }
      return s;
    };
    var MAX_SIZE = Math.pow(2, 32);
    DataStream.prototype.readInt64 = function() {
      return this.readInt32() * MAX_SIZE + this.readUint32();
    };
    DataStream.prototype.readUint64 = function() {
      return this.readUint32() * MAX_SIZE + this.readUint32();
    };
    DataStream.prototype.readInt64 = function() {
      return this.readUint32() * MAX_SIZE + this.readUint32();
    };
    DataStream.prototype.readUint24 = function() {
      return (this.readUint8() << 16) + (this.readUint8() << 8) + this.readUint8();
    };
    if (typeof exports !== "undefined") {
      exports.DataStream = DataStream;
    }
    DataStream.prototype.save = function(filename) {
      var blob = new Blob([this.buffer]);
      if (window.URL && URL.createObjectURL) {
        var url = window.URL.createObjectURL(blob);
        var a = document.createElement("a");
        document.body.appendChild(a);
        a.setAttribute("href", url);
        a.setAttribute("download", filename);
        a.setAttribute("target", "_self");
        a.click();
        window.URL.revokeObjectURL(url);
      } else {
        throw "DataStream.save: Can't create object URL.";
      }
    };
    DataStream.prototype._dynamicSize = true;
    Object.defineProperty(
      DataStream.prototype,
      "dynamicSize",
      {
        get: function() {
          return this._dynamicSize;
        },
        set: function(v2) {
          if (!v2) {
            this._trimAlloc();
          }
          this._dynamicSize = v2;
        }
      }
    );
    DataStream.prototype.shift = function(offset) {
      var buf = new ArrayBuffer(this._byteLength - offset);
      var dst = new Uint8Array(buf);
      var src = new Uint8Array(this._buffer, offset, dst.length);
      dst.set(src);
      this.buffer = buf;
      this.position -= offset;
    };
    DataStream.prototype.writeInt32Array = function(arr, e) {
      this._realloc(arr.length * 4);
      if (arr instanceof Int32Array && this.byteOffset + this.position % arr.BYTES_PER_ELEMENT === 0) {
        DataStream.memcpy(
          this._buffer,
          this.byteOffset + this.position,
          arr.buffer,
          0,
          arr.byteLength
        );
        this.mapInt32Array(arr.length, e);
      } else {
        for (var i2 = 0; i2 < arr.length; i2++) {
          this.writeInt32(arr[i2], e);
        }
      }
    };
    DataStream.prototype.writeInt16Array = function(arr, e) {
      this._realloc(arr.length * 2);
      if (arr instanceof Int16Array && this.byteOffset + this.position % arr.BYTES_PER_ELEMENT === 0) {
        DataStream.memcpy(
          this._buffer,
          this.byteOffset + this.position,
          arr.buffer,
          0,
          arr.byteLength
        );
        this.mapInt16Array(arr.length, e);
      } else {
        for (var i2 = 0; i2 < arr.length; i2++) {
          this.writeInt16(arr[i2], e);
        }
      }
    };
    DataStream.prototype.writeInt8Array = function(arr) {
      this._realloc(arr.length * 1);
      if (arr instanceof Int8Array && this.byteOffset + this.position % arr.BYTES_PER_ELEMENT === 0) {
        DataStream.memcpy(
          this._buffer,
          this.byteOffset + this.position,
          arr.buffer,
          0,
          arr.byteLength
        );
        this.mapInt8Array(arr.length);
      } else {
        for (var i2 = 0; i2 < arr.length; i2++) {
          this.writeInt8(arr[i2]);
        }
      }
    };
    DataStream.prototype.writeUint32Array = function(arr, e) {
      this._realloc(arr.length * 4);
      if (arr instanceof Uint32Array && this.byteOffset + this.position % arr.BYTES_PER_ELEMENT === 0) {
        DataStream.memcpy(
          this._buffer,
          this.byteOffset + this.position,
          arr.buffer,
          0,
          arr.byteLength
        );
        this.mapUint32Array(arr.length, e);
      } else {
        for (var i2 = 0; i2 < arr.length; i2++) {
          this.writeUint32(arr[i2], e);
        }
      }
    };
    DataStream.prototype.writeUint16Array = function(arr, e) {
      this._realloc(arr.length * 2);
      if (arr instanceof Uint16Array && this.byteOffset + this.position % arr.BYTES_PER_ELEMENT === 0) {
        DataStream.memcpy(
          this._buffer,
          this.byteOffset + this.position,
          arr.buffer,
          0,
          arr.byteLength
        );
        this.mapUint16Array(arr.length, e);
      } else {
        for (var i2 = 0; i2 < arr.length; i2++) {
          this.writeUint16(arr[i2], e);
        }
      }
    };
    DataStream.prototype.writeUint8Array = function(arr) {
      this._realloc(arr.length * 1);
      if (arr instanceof Uint8Array && this.byteOffset + this.position % arr.BYTES_PER_ELEMENT === 0) {
        DataStream.memcpy(
          this._buffer,
          this.byteOffset + this.position,
          arr.buffer,
          0,
          arr.byteLength
        );
        this.mapUint8Array(arr.length);
      } else {
        for (var i2 = 0; i2 < arr.length; i2++) {
          this.writeUint8(arr[i2]);
        }
      }
    };
    DataStream.prototype.writeFloat64Array = function(arr, e) {
      this._realloc(arr.length * 8);
      if (arr instanceof Float64Array && this.byteOffset + this.position % arr.BYTES_PER_ELEMENT === 0) {
        DataStream.memcpy(
          this._buffer,
          this.byteOffset + this.position,
          arr.buffer,
          0,
          arr.byteLength
        );
        this.mapFloat64Array(arr.length, e);
      } else {
        for (var i2 = 0; i2 < arr.length; i2++) {
          this.writeFloat64(arr[i2], e);
        }
      }
    };
    DataStream.prototype.writeFloat32Array = function(arr, e) {
      this._realloc(arr.length * 4);
      if (arr instanceof Float32Array && this.byteOffset + this.position % arr.BYTES_PER_ELEMENT === 0) {
        DataStream.memcpy(
          this._buffer,
          this.byteOffset + this.position,
          arr.buffer,
          0,
          arr.byteLength
        );
        this.mapFloat32Array(arr.length, e);
      } else {
        for (var i2 = 0; i2 < arr.length; i2++) {
          this.writeFloat32(arr[i2], e);
        }
      }
    };
    DataStream.prototype.writeInt32 = function(v2, e) {
      this._realloc(4);
      this._dataView.setInt32(this.position, v2, e == null ? this.endianness : e);
      this.position += 4;
    };
    DataStream.prototype.writeInt16 = function(v2, e) {
      this._realloc(2);
      this._dataView.setInt16(this.position, v2, e == null ? this.endianness : e);
      this.position += 2;
    };
    DataStream.prototype.writeInt8 = function(v2) {
      this._realloc(1);
      this._dataView.setInt8(this.position, v2);
      this.position += 1;
    };
    DataStream.prototype.writeUint32 = function(v2, e) {
      this._realloc(4);
      this._dataView.setUint32(this.position, v2, e == null ? this.endianness : e);
      this.position += 4;
    };
    DataStream.prototype.writeUint16 = function(v2, e) {
      this._realloc(2);
      this._dataView.setUint16(this.position, v2, e == null ? this.endianness : e);
      this.position += 2;
    };
    DataStream.prototype.writeUint8 = function(v2) {
      this._realloc(1);
      this._dataView.setUint8(this.position, v2);
      this.position += 1;
    };
    DataStream.prototype.writeFloat32 = function(v2, e) {
      this._realloc(4);
      this._dataView.setFloat32(this.position, v2, e == null ? this.endianness : e);
      this.position += 4;
    };
    DataStream.prototype.writeFloat64 = function(v2, e) {
      this._realloc(8);
      this._dataView.setFloat64(this.position, v2, e == null ? this.endianness : e);
      this.position += 8;
    };
    DataStream.prototype.writeUCS2String = function(str, endianness, lengthOverride) {
      if (lengthOverride == null) {
        lengthOverride = str.length;
      }
      for (var i2 = 0; i2 < str.length && i2 < lengthOverride; i2++) {
        this.writeUint16(str.charCodeAt(i2), endianness);
      }
      for (; i2 < lengthOverride; i2++) {
        this.writeUint16(0);
      }
    };
    DataStream.prototype.writeString = function(s, encoding, length) {
      var i2 = 0;
      if (encoding == null || encoding == "ASCII") {
        if (length != null) {
          var len = Math.min(s.length, length);
          for (i2 = 0; i2 < len; i2++) {
            this.writeUint8(s.charCodeAt(i2));
          }
          for (; i2 < length; i2++) {
            this.writeUint8(0);
          }
        } else {
          for (i2 = 0; i2 < s.length; i2++) {
            this.writeUint8(s.charCodeAt(i2));
          }
        }
      } else {
        this.writeUint8Array(new TextEncoder(encoding).encode(s.substring(0, length)));
      }
    };
    DataStream.prototype.writeCString = function(s, length) {
      var i2 = 0;
      if (length != null) {
        var len = Math.min(s.length, length);
        for (i2 = 0; i2 < len; i2++) {
          this.writeUint8(s.charCodeAt(i2));
        }
        for (; i2 < length; i2++) {
          this.writeUint8(0);
        }
      } else {
        for (i2 = 0; i2 < s.length; i2++) {
          this.writeUint8(s.charCodeAt(i2));
        }
        this.writeUint8(0);
      }
    };
    DataStream.prototype.writeStruct = function(structDefinition, struct) {
      for (var i2 = 0; i2 < structDefinition.length; i2 += 2) {
        var t = structDefinition[i2 + 1];
        this.writeType(t, struct[structDefinition[i2]], struct);
      }
    };
    DataStream.prototype.writeType = function(t, v2, struct) {
      var tp;
      if (typeof t == "function") {
        return t(this, v2);
      } else if (typeof t == "object" && !(t instanceof Array)) {
        return t.set(this, v2, struct);
      }
      var lengthOverride = null;
      var charset = "ASCII";
      var pos = this.position;
      if (typeof t == "string" && /:/.test(t)) {
        tp = t.split(":");
        t = tp[0];
        lengthOverride = parseInt(tp[1]);
      }
      if (typeof t == "string" && /,/.test(t)) {
        tp = t.split(",");
        t = tp[0];
        charset = parseInt(tp[1]);
      }
      switch (t) {
        case "uint8":
          this.writeUint8(v2);
          break;
        case "int8":
          this.writeInt8(v2);
          break;
        case "uint16":
          this.writeUint16(v2, this.endianness);
          break;
        case "int16":
          this.writeInt16(v2, this.endianness);
          break;
        case "uint32":
          this.writeUint32(v2, this.endianness);
          break;
        case "int32":
          this.writeInt32(v2, this.endianness);
          break;
        case "float32":
          this.writeFloat32(v2, this.endianness);
          break;
        case "float64":
          this.writeFloat64(v2, this.endianness);
          break;
        case "uint16be":
          this.writeUint16(v2, DataStream.BIG_ENDIAN);
          break;
        case "int16be":
          this.writeInt16(v2, DataStream.BIG_ENDIAN);
          break;
        case "uint32be":
          this.writeUint32(v2, DataStream.BIG_ENDIAN);
          break;
        case "int32be":
          this.writeInt32(v2, DataStream.BIG_ENDIAN);
          break;
        case "float32be":
          this.writeFloat32(v2, DataStream.BIG_ENDIAN);
          break;
        case "float64be":
          this.writeFloat64(v2, DataStream.BIG_ENDIAN);
          break;
        case "uint16le":
          this.writeUint16(v2, DataStream.LITTLE_ENDIAN);
          break;
        case "int16le":
          this.writeInt16(v2, DataStream.LITTLE_ENDIAN);
          break;
        case "uint32le":
          this.writeUint32(v2, DataStream.LITTLE_ENDIAN);
          break;
        case "int32le":
          this.writeInt32(v2, DataStream.LITTLE_ENDIAN);
          break;
        case "float32le":
          this.writeFloat32(v2, DataStream.LITTLE_ENDIAN);
          break;
        case "float64le":
          this.writeFloat64(v2, DataStream.LITTLE_ENDIAN);
          break;
        case "cstring":
          this.writeCString(v2, lengthOverride);
          break;
        case "string":
          this.writeString(v2, charset, lengthOverride);
          break;
        case "u16string":
          this.writeUCS2String(v2, this.endianness, lengthOverride);
          break;
        case "u16stringle":
          this.writeUCS2String(v2, DataStream.LITTLE_ENDIAN, lengthOverride);
          break;
        case "u16stringbe":
          this.writeUCS2String(v2, DataStream.BIG_ENDIAN, lengthOverride);
          break;
        default:
          if (t.length == 3) {
            var ta = t[1];
            for (var i2 = 0; i2 < v2.length; i2++) {
              this.writeType(ta, v2[i2]);
            }
            break;
          } else {
            this.writeStruct(t, v2);
            break;
          }
      }
      if (lengthOverride != null) {
        this.position = pos;
        this._realloc(lengthOverride);
        this.position = pos + lengthOverride;
      }
    };
    DataStream.prototype.writeUint64 = function(v2) {
      var h = Math.floor(v2 / MAX_SIZE);
      this.writeUint32(h);
      this.writeUint32(v2 & 4294967295);
    };
    DataStream.prototype.writeUint24 = function(v2) {
      this.writeUint8((v2 & 16711680) >> 16);
      this.writeUint8((v2 & 65280) >> 8);
      this.writeUint8(v2 & 255);
    };
    DataStream.prototype.adjustUint32 = function(position, value) {
      var pos = this.position;
      this.seek(position);
      this.writeUint32(value);
      this.seek(pos);
    };
    DataStream.prototype.mapInt32Array = function(length, e) {
      this._realloc(length * 4);
      var arr = new Int32Array(this._buffer, this.byteOffset + this.position, length);
      DataStream.arrayToNative(arr, e == null ? this.endianness : e);
      this.position += length * 4;
      return arr;
    };
    DataStream.prototype.mapInt16Array = function(length, e) {
      this._realloc(length * 2);
      var arr = new Int16Array(this._buffer, this.byteOffset + this.position, length);
      DataStream.arrayToNative(arr, e == null ? this.endianness : e);
      this.position += length * 2;
      return arr;
    };
    DataStream.prototype.mapInt8Array = function(length) {
      this._realloc(length * 1);
      var arr = new Int8Array(this._buffer, this.byteOffset + this.position, length);
      this.position += length * 1;
      return arr;
    };
    DataStream.prototype.mapUint32Array = function(length, e) {
      this._realloc(length * 4);
      var arr = new Uint32Array(this._buffer, this.byteOffset + this.position, length);
      DataStream.arrayToNative(arr, e == null ? this.endianness : e);
      this.position += length * 4;
      return arr;
    };
    DataStream.prototype.mapUint16Array = function(length, e) {
      this._realloc(length * 2);
      var arr = new Uint16Array(this._buffer, this.byteOffset + this.position, length);
      DataStream.arrayToNative(arr, e == null ? this.endianness : e);
      this.position += length * 2;
      return arr;
    };
    DataStream.prototype.mapFloat64Array = function(length, e) {
      this._realloc(length * 8);
      var arr = new Float64Array(this._buffer, this.byteOffset + this.position, length);
      DataStream.arrayToNative(arr, e == null ? this.endianness : e);
      this.position += length * 8;
      return arr;
    };
    DataStream.prototype.mapFloat32Array = function(length, e) {
      this._realloc(length * 4);
      var arr = new Float32Array(this._buffer, this.byteOffset + this.position, length);
      DataStream.arrayToNative(arr, e == null ? this.endianness : e);
      this.position += length * 4;
      return arr;
    };
    var MultiBufferStream = function(buffer) {
      this.buffers = [];
      this.bufferIndex = -1;
      if (buffer) {
        this.insertBuffer(buffer);
        this.bufferIndex = 0;
      }
    };
    MultiBufferStream.prototype = new DataStream(new ArrayBuffer(), 0, DataStream.BIG_ENDIAN);
    MultiBufferStream.prototype.initialized = function() {
      var firstBuffer;
      if (this.bufferIndex > -1) {
        return true;
      } else if (this.buffers.length > 0) {
        firstBuffer = this.buffers[0];
        if (firstBuffer.fileStart === 0) {
          this.buffer = firstBuffer;
          this.bufferIndex = 0;
          Log.debug("MultiBufferStream", "Stream ready for parsing");
          return true;
        } else {
          Log.warn("MultiBufferStream", "The first buffer should have a fileStart of 0");
          this.logBufferLevel();
          return false;
        }
      } else {
        Log.warn("MultiBufferStream", "No buffer to start parsing from");
        this.logBufferLevel();
        return false;
      }
    };
    ArrayBuffer.concat = function(buffer1, buffer2) {
      Log.debug("ArrayBuffer", "Trying to create a new buffer of size: " + (buffer1.byteLength + buffer2.byteLength));
      var tmp = new Uint8Array(buffer1.byteLength + buffer2.byteLength);
      tmp.set(new Uint8Array(buffer1), 0);
      tmp.set(new Uint8Array(buffer2), buffer1.byteLength);
      return tmp.buffer;
    };
    MultiBufferStream.prototype.reduceBuffer = function(buffer, offset, newLength) {
      var smallB;
      smallB = new Uint8Array(newLength);
      smallB.set(new Uint8Array(buffer, offset, newLength));
      smallB.buffer.fileStart = buffer.fileStart + offset;
      smallB.buffer.usedBytes = 0;
      return smallB.buffer;
    };
    MultiBufferStream.prototype.insertBuffer = function(ab) {
      var to_add = true;
      for (var i2 = 0; i2 < this.buffers.length; i2++) {
        var b = this.buffers[i2];
        if (ab.fileStart <= b.fileStart) {
          if (ab.fileStart === b.fileStart) {
            if (ab.byteLength > b.byteLength) {
              this.buffers.splice(i2, 1);
              i2--;
              continue;
            } else {
              Log.warn("MultiBufferStream", "Buffer (fileStart: " + ab.fileStart + " - Length: " + ab.byteLength + ") already appended, ignoring");
            }
          } else {
            if (ab.fileStart + ab.byteLength <= b.fileStart) {
            } else {
              ab = this.reduceBuffer(ab, 0, b.fileStart - ab.fileStart);
            }
            Log.debug("MultiBufferStream", "Appending new buffer (fileStart: " + ab.fileStart + " - Length: " + ab.byteLength + ")");
            this.buffers.splice(i2, 0, ab);
            if (i2 === 0) {
              this.buffer = ab;
            }
          }
          to_add = false;
          break;
        } else if (ab.fileStart < b.fileStart + b.byteLength) {
          var offset = b.fileStart + b.byteLength - ab.fileStart;
          var newLength = ab.byteLength - offset;
          if (newLength > 0) {
            ab = this.reduceBuffer(ab, offset, newLength);
          } else {
            to_add = false;
            break;
          }
        }
      }
      if (to_add) {
        Log.debug("MultiBufferStream", "Appending new buffer (fileStart: " + ab.fileStart + " - Length: " + ab.byteLength + ")");
        this.buffers.push(ab);
        if (i2 === 0) {
          this.buffer = ab;
        }
      }
    };
    MultiBufferStream.prototype.logBufferLevel = function(info) {
      var i2;
      var buffer;
      var used, total;
      var ranges = [];
      var range;
      var bufferedString = "";
      used = 0;
      total = 0;
      for (i2 = 0; i2 < this.buffers.length; i2++) {
        buffer = this.buffers[i2];
        if (i2 === 0) {
          range = {};
          ranges.push(range);
          range.start = buffer.fileStart;
          range.end = buffer.fileStart + buffer.byteLength;
          bufferedString += "[" + range.start + "-";
        } else if (range.end === buffer.fileStart) {
          range.end = buffer.fileStart + buffer.byteLength;
        } else {
          range = {};
          range.start = buffer.fileStart;
          bufferedString += ranges[ranges.length - 1].end - 1 + "], [" + range.start + "-";
          range.end = buffer.fileStart + buffer.byteLength;
          ranges.push(range);
        }
        used += buffer.usedBytes;
        total += buffer.byteLength;
      }
      if (ranges.length > 0) {
        bufferedString += range.end - 1 + "]";
      }
      var log = info ? Log.info : Log.debug;
      if (this.buffers.length === 0) {
        log("MultiBufferStream", "No more buffer in memory");
      } else {
        log("MultiBufferStream", "" + this.buffers.length + " stored buffer(s) (" + used + "/" + total + " bytes), continuous ranges: " + bufferedString);
      }
    };
    MultiBufferStream.prototype.cleanBuffers = function() {
      var i2;
      var buffer;
      for (i2 = 0; i2 < this.buffers.length; i2++) {
        buffer = this.buffers[i2];
        if (buffer.usedBytes === buffer.byteLength) {
          Log.debug("MultiBufferStream", "Removing buffer #" + i2);
          this.buffers.splice(i2, 1);
          i2--;
        }
      }
    };
    MultiBufferStream.prototype.mergeNextBuffer = function() {
      var next_buffer;
      if (this.bufferIndex + 1 < this.buffers.length) {
        next_buffer = this.buffers[this.bufferIndex + 1];
        if (next_buffer.fileStart === this.buffer.fileStart + this.buffer.byteLength) {
          var oldLength = this.buffer.byteLength;
          var oldUsedBytes = this.buffer.usedBytes;
          var oldFileStart = this.buffer.fileStart;
          this.buffers[this.bufferIndex] = ArrayBuffer.concat(this.buffer, next_buffer);
          this.buffer = this.buffers[this.bufferIndex];
          this.buffers.splice(this.bufferIndex + 1, 1);
          this.buffer.usedBytes = oldUsedBytes;
          this.buffer.fileStart = oldFileStart;
          Log.debug("ISOFile", "Concatenating buffer for box parsing (length: " + oldLength + "->" + this.buffer.byteLength + ")");
          return true;
        } else {
          return false;
        }
      } else {
        return false;
      }
    };
    MultiBufferStream.prototype.findPosition = function(fromStart, filePosition, markAsUsed) {
      var i2;
      var abuffer = null;
      var index = -1;
      if (fromStart === true) {
        i2 = 0;
      } else {
        i2 = this.bufferIndex;
      }
      while (i2 < this.buffers.length) {
        abuffer = this.buffers[i2];
        if (abuffer.fileStart <= filePosition) {
          index = i2;
          if (markAsUsed) {
            if (abuffer.fileStart + abuffer.byteLength <= filePosition) {
              abuffer.usedBytes = abuffer.byteLength;
            } else {
              abuffer.usedBytes = filePosition - abuffer.fileStart;
            }
            this.logBufferLevel();
          }
        } else {
          break;
        }
        i2++;
      }
      if (index !== -1) {
        abuffer = this.buffers[index];
        if (abuffer.fileStart + abuffer.byteLength >= filePosition) {
          Log.debug("MultiBufferStream", "Found position in existing buffer #" + index);
          return index;
        } else {
          return -1;
        }
      } else {
        return -1;
      }
    };
    MultiBufferStream.prototype.findEndContiguousBuf = function(inputindex) {
      var i2;
      var currentBuf;
      var nextBuf;
      var index = inputindex !== void 0 ? inputindex : this.bufferIndex;
      currentBuf = this.buffers[index];
      if (this.buffers.length > index + 1) {
        for (i2 = index + 1; i2 < this.buffers.length; i2++) {
          nextBuf = this.buffers[i2];
          if (nextBuf.fileStart === currentBuf.fileStart + currentBuf.byteLength) {
            currentBuf = nextBuf;
          } else {
            break;
          }
        }
      }
      return currentBuf.fileStart + currentBuf.byteLength;
    };
    MultiBufferStream.prototype.getEndFilePositionAfter = function(pos) {
      var index = this.findPosition(true, pos, false);
      if (index !== -1) {
        return this.findEndContiguousBuf(index);
      } else {
        return pos;
      }
    };
    MultiBufferStream.prototype.addUsedBytes = function(nbBytes) {
      this.buffer.usedBytes += nbBytes;
      this.logBufferLevel();
    };
    MultiBufferStream.prototype.setAllUsedBytes = function() {
      this.buffer.usedBytes = this.buffer.byteLength;
      this.logBufferLevel();
    };
    MultiBufferStream.prototype.seek = function(filePosition, fromStart, markAsUsed) {
      var index;
      index = this.findPosition(fromStart, filePosition, markAsUsed);
      if (index !== -1) {
        this.buffer = this.buffers[index];
        this.bufferIndex = index;
        this.position = filePosition - this.buffer.fileStart;
        Log.debug("MultiBufferStream", "Repositioning parser at buffer position: " + this.position);
        return true;
      } else {
        Log.debug("MultiBufferStream", "Position " + filePosition + " not found in buffered data");
        return false;
      }
    };
    MultiBufferStream.prototype.getPosition = function() {
      if (this.bufferIndex === -1 || this.buffers[this.bufferIndex] === null) {
        throw "Error accessing position in the MultiBufferStream";
      }
      return this.buffers[this.bufferIndex].fileStart + this.position;
    };
    MultiBufferStream.prototype.getLength = function() {
      return this.byteLength;
    };
    MultiBufferStream.prototype.getEndPosition = function() {
      if (this.bufferIndex === -1 || this.buffers[this.bufferIndex] === null) {
        throw "Error accessing position in the MultiBufferStream";
      }
      return this.buffers[this.bufferIndex].fileStart + this.byteLength;
    };
    if (typeof exports !== "undefined") {
      exports.MultiBufferStream = MultiBufferStream;
    }
    var MPEG4DescriptorParser = function() {
      var ES_DescrTag = 3;
      var DecoderConfigDescrTag = 4;
      var DecSpecificInfoTag = 5;
      var SLConfigDescrTag = 6;
      var descTagToName = [];
      descTagToName[ES_DescrTag] = "ES_Descriptor";
      descTagToName[DecoderConfigDescrTag] = "DecoderConfigDescriptor";
      descTagToName[DecSpecificInfoTag] = "DecoderSpecificInfo";
      descTagToName[SLConfigDescrTag] = "SLConfigDescriptor";
      this.getDescriptorName = function(tag) {
        return descTagToName[tag];
      };
      var that = this;
      var classes = {};
      this.parseOneDescriptor = function(stream) {
        var hdrSize = 0;
        var size = 0;
        var tag;
        var desc;
        var byteRead;
        tag = stream.readUint8();
        hdrSize++;
        byteRead = stream.readUint8();
        hdrSize++;
        while (byteRead & 128) {
          size = (byteRead & 127) << 7;
          byteRead = stream.readUint8();
          hdrSize++;
        }
        size += byteRead & 127;
        Log.debug("MPEG4DescriptorParser", "Found " + (descTagToName[tag] || "Descriptor " + tag) + ", size " + size + " at position " + stream.getPosition());
        if (descTagToName[tag]) {
          desc = new classes[descTagToName[tag]](size);
        } else {
          desc = new classes.Descriptor(size);
        }
        desc.parse(stream);
        return desc;
      };
      classes.Descriptor = function(_tag, _size) {
        this.tag = _tag;
        this.size = _size;
        this.descs = [];
      };
      classes.Descriptor.prototype.parse = function(stream) {
        this.data = stream.readUint8Array(this.size);
      };
      classes.Descriptor.prototype.findDescriptor = function(tag) {
        for (var i2 = 0; i2 < this.descs.length; i2++) {
          if (this.descs[i2].tag == tag) {
            return this.descs[i2];
          }
        }
        return null;
      };
      classes.Descriptor.prototype.parseRemainingDescriptors = function(stream) {
        var start = stream.position;
        while (stream.position < start + this.size) {
          var desc = that.parseOneDescriptor(stream);
          this.descs.push(desc);
        }
      };
      classes.ES_Descriptor = function(size) {
        classes.Descriptor.call(this, ES_DescrTag, size);
      };
      classes.ES_Descriptor.prototype = new classes.Descriptor();
      classes.ES_Descriptor.prototype.parse = function(stream) {
        this.ES_ID = stream.readUint16();
        this.flags = stream.readUint8();
        this.size -= 3;
        if (this.flags & 128) {
          this.dependsOn_ES_ID = stream.readUint16();
          this.size -= 2;
        } else {
          this.dependsOn_ES_ID = 0;
        }
        if (this.flags & 64) {
          var l2 = stream.readUint8();
          this.URL = stream.readString(l2);
          this.size -= l2 + 1;
        } else {
          this.URL = "";
        }
        if (this.flags & 32) {
          this.OCR_ES_ID = stream.readUint16();
          this.size -= 2;
        } else {
          this.OCR_ES_ID = 0;
        }
        this.parseRemainingDescriptors(stream);
      };
      classes.ES_Descriptor.prototype.getOTI = function(stream) {
        var dcd = this.findDescriptor(DecoderConfigDescrTag);
        if (dcd) {
          return dcd.oti;
        } else {
          return 0;
        }
      };
      classes.ES_Descriptor.prototype.getAudioConfig = function(stream) {
        var dcd = this.findDescriptor(DecoderConfigDescrTag);
        if (!dcd) return null;
        var dsi = dcd.findDescriptor(DecSpecificInfoTag);
        if (dsi && dsi.data) {
          var audioObjectType = (dsi.data[0] & 248) >> 3;
          if (audioObjectType === 31 && dsi.data.length >= 2) {
            audioObjectType = 32 + ((dsi.data[0] & 7) << 3) + ((dsi.data[1] & 224) >> 5);
          }
          return audioObjectType;
        } else {
          return null;
        }
      };
      classes.DecoderConfigDescriptor = function(size) {
        classes.Descriptor.call(this, DecoderConfigDescrTag, size);
      };
      classes.DecoderConfigDescriptor.prototype = new classes.Descriptor();
      classes.DecoderConfigDescriptor.prototype.parse = function(stream) {
        this.oti = stream.readUint8();
        this.streamType = stream.readUint8();
        this.upStream = (this.streamType >> 1 & 1) !== 0;
        this.streamType = this.streamType >>> 2;
        this.bufferSize = stream.readUint24();
        this.maxBitrate = stream.readUint32();
        this.avgBitrate = stream.readUint32();
        this.size -= 13;
        this.parseRemainingDescriptors(stream);
      };
      classes.DecoderSpecificInfo = function(size) {
        classes.Descriptor.call(this, DecSpecificInfoTag, size);
      };
      classes.DecoderSpecificInfo.prototype = new classes.Descriptor();
      classes.SLConfigDescriptor = function(size) {
        classes.Descriptor.call(this, SLConfigDescrTag, size);
      };
      classes.SLConfigDescriptor.prototype = new classes.Descriptor();
      return this;
    };
    if (typeof exports !== "undefined") {
      exports.MPEG4DescriptorParser = MPEG4DescriptorParser;
    }
    var BoxParser = {
      ERR_INVALID_DATA: -1,
      ERR_NOT_ENOUGH_DATA: 0,
      OK: 1,
      // Boxes to be created with default parsing
      BASIC_BOXES: ["mdat", "idat", "free", "skip", "meco", "strk"],
      FULL_BOXES: ["hmhd", "nmhd", "iods", "xml ", "bxml", "ipro", "mere"],
      CONTAINER_BOXES: [
        ["moov", ["trak", "pssh"]],
        ["trak"],
        ["edts"],
        ["mdia"],
        ["minf"],
        ["dinf"],
        ["stbl", ["sgpd", "sbgp"]],
        ["mvex", ["trex"]],
        ["moof", ["traf"]],
        ["traf", ["trun", "sgpd", "sbgp"]],
        ["vttc"],
        ["tref"],
        ["iref"],
        ["mfra", ["tfra"]],
        ["meco"],
        ["hnti"],
        ["hinf"],
        ["strk"],
        ["strd"],
        ["sinf"],
        ["rinf"],
        ["schi"],
        ["trgr"],
        ["udta", ["kind"]],
        ["iprp", ["ipma"]],
        ["ipco"],
        ["grpl"],
        ["j2kH"],
        ["etyp", ["tyco"]]
      ],
      // Boxes effectively created
      boxCodes: [],
      fullBoxCodes: [],
      containerBoxCodes: [],
      sampleEntryCodes: {},
      sampleGroupEntryCodes: [],
      trackGroupTypes: [],
      UUIDBoxes: {},
      UUIDs: [],
      initialize: function() {
        BoxParser.FullBox.prototype = new BoxParser.Box();
        BoxParser.ContainerBox.prototype = new BoxParser.Box();
        BoxParser.SampleEntry.prototype = new BoxParser.Box();
        BoxParser.TrackGroupTypeBox.prototype = new BoxParser.FullBox();
        BoxParser.BASIC_BOXES.forEach(function(type) {
          BoxParser.createBoxCtor(type);
        });
        BoxParser.FULL_BOXES.forEach(function(type) {
          BoxParser.createFullBoxCtor(type);
        });
        BoxParser.CONTAINER_BOXES.forEach(function(types) {
          BoxParser.createContainerBoxCtor(types[0], null, types[1]);
        });
      },
      Box: function(_type, _size, _uuid) {
        this.type = _type;
        this.size = _size;
        this.uuid = _uuid;
      },
      FullBox: function(type, size, uuid) {
        BoxParser.Box.call(this, type, size, uuid);
        this.flags = 0;
        this.version = 0;
      },
      ContainerBox: function(type, size, uuid) {
        BoxParser.Box.call(this, type, size, uuid);
        this.boxes = [];
      },
      SampleEntry: function(type, size, hdr_size, start) {
        BoxParser.ContainerBox.call(this, type, size);
        this.hdr_size = hdr_size;
        this.start = start;
      },
      SampleGroupEntry: function(type) {
        this.grouping_type = type;
      },
      TrackGroupTypeBox: function(type, size) {
        BoxParser.FullBox.call(this, type, size);
      },
      createBoxCtor: function(type, parseMethod) {
        BoxParser.boxCodes.push(type);
        BoxParser[type + "Box"] = function(size) {
          BoxParser.Box.call(this, type, size);
        };
        BoxParser[type + "Box"].prototype = new BoxParser.Box();
        if (parseMethod) BoxParser[type + "Box"].prototype.parse = parseMethod;
      },
      createFullBoxCtor: function(type, parseMethod) {
        BoxParser[type + "Box"] = function(size) {
          BoxParser.FullBox.call(this, type, size);
        };
        BoxParser[type + "Box"].prototype = new BoxParser.FullBox();
        BoxParser[type + "Box"].prototype.parse = function(stream) {
          this.parseFullHeader(stream);
          if (parseMethod) {
            parseMethod.call(this, stream);
          }
        };
      },
      addSubBoxArrays: function(subBoxNames) {
        if (subBoxNames) {
          this.subBoxNames = subBoxNames;
          var nbSubBoxes = subBoxNames.length;
          for (var k2 = 0; k2 < nbSubBoxes; k2++) {
            this[subBoxNames[k2] + "s"] = [];
          }
        }
      },
      createContainerBoxCtor: function(type, parseMethod, subBoxNames) {
        BoxParser[type + "Box"] = function(size) {
          BoxParser.ContainerBox.call(this, type, size);
          BoxParser.addSubBoxArrays.call(this, subBoxNames);
        };
        BoxParser[type + "Box"].prototype = new BoxParser.ContainerBox();
        if (parseMethod) BoxParser[type + "Box"].prototype.parse = parseMethod;
      },
      createMediaSampleEntryCtor: function(mediaType, parseMethod, subBoxNames) {
        BoxParser.sampleEntryCodes[mediaType] = [];
        BoxParser[mediaType + "SampleEntry"] = function(type, size) {
          BoxParser.SampleEntry.call(this, type, size);
          BoxParser.addSubBoxArrays.call(this, subBoxNames);
        };
        BoxParser[mediaType + "SampleEntry"].prototype = new BoxParser.SampleEntry();
        if (parseMethod) BoxParser[mediaType + "SampleEntry"].prototype.parse = parseMethod;
      },
      createSampleEntryCtor: function(mediaType, type, parseMethod, subBoxNames) {
        BoxParser.sampleEntryCodes[mediaType].push(type);
        BoxParser[type + "SampleEntry"] = function(size) {
          BoxParser[mediaType + "SampleEntry"].call(this, type, size);
          BoxParser.addSubBoxArrays.call(this, subBoxNames);
        };
        BoxParser[type + "SampleEntry"].prototype = new BoxParser[mediaType + "SampleEntry"]();
        if (parseMethod) BoxParser[type + "SampleEntry"].prototype.parse = parseMethod;
      },
      createEncryptedSampleEntryCtor: function(mediaType, type, parseMethod) {
        BoxParser.createSampleEntryCtor.call(this, mediaType, type, parseMethod, ["sinf"]);
      },
      createSampleGroupCtor: function(type, parseMethod) {
        BoxParser[type + "SampleGroupEntry"] = function(size) {
          BoxParser.SampleGroupEntry.call(this, type, size);
        };
        BoxParser[type + "SampleGroupEntry"].prototype = new BoxParser.SampleGroupEntry();
        if (parseMethod) BoxParser[type + "SampleGroupEntry"].prototype.parse = parseMethod;
      },
      createTrackGroupCtor: function(type, parseMethod) {
        BoxParser[type + "TrackGroupTypeBox"] = function(size) {
          BoxParser.TrackGroupTypeBox.call(this, type, size);
        };
        BoxParser[type + "TrackGroupTypeBox"].prototype = new BoxParser.TrackGroupTypeBox();
        if (parseMethod) BoxParser[type + "TrackGroupTypeBox"].prototype.parse = parseMethod;
      },
      createUUIDBox: function(uuid, isFullBox, isContainerBox, parseMethod) {
        BoxParser.UUIDs.push(uuid);
        BoxParser.UUIDBoxes[uuid] = function(size) {
          if (isFullBox) {
            BoxParser.FullBox.call(this, "uuid", size, uuid);
          } else {
            if (isContainerBox) {
              BoxParser.ContainerBox.call(this, "uuid", size, uuid);
            } else {
              BoxParser.Box.call(this, "uuid", size, uuid);
            }
          }
        };
        BoxParser.UUIDBoxes[uuid].prototype = isFullBox ? new BoxParser.FullBox() : isContainerBox ? new BoxParser.ContainerBox() : new BoxParser.Box();
        if (parseMethod) {
          if (isFullBox) {
            BoxParser.UUIDBoxes[uuid].prototype.parse = function(stream) {
              this.parseFullHeader(stream);
              if (parseMethod) {
                parseMethod.call(this, stream);
              }
            };
          } else {
            BoxParser.UUIDBoxes[uuid].prototype.parse = parseMethod;
          }
        }
      }
    };
    BoxParser.initialize();
    BoxParser.TKHD_FLAG_ENABLED = 1;
    BoxParser.TKHD_FLAG_IN_MOVIE = 2;
    BoxParser.TKHD_FLAG_IN_PREVIEW = 4;
    BoxParser.TFHD_FLAG_BASE_DATA_OFFSET = 1;
    BoxParser.TFHD_FLAG_SAMPLE_DESC = 2;
    BoxParser.TFHD_FLAG_SAMPLE_DUR = 8;
    BoxParser.TFHD_FLAG_SAMPLE_SIZE = 16;
    BoxParser.TFHD_FLAG_SAMPLE_FLAGS = 32;
    BoxParser.TFHD_FLAG_DUR_EMPTY = 65536;
    BoxParser.TFHD_FLAG_DEFAULT_BASE_IS_MOOF = 131072;
    BoxParser.TRUN_FLAGS_DATA_OFFSET = 1;
    BoxParser.TRUN_FLAGS_FIRST_FLAG = 4;
    BoxParser.TRUN_FLAGS_DURATION = 256;
    BoxParser.TRUN_FLAGS_SIZE = 512;
    BoxParser.TRUN_FLAGS_FLAGS = 1024;
    BoxParser.TRUN_FLAGS_CTS_OFFSET = 2048;
    BoxParser.Box.prototype.add = function(name) {
      return this.addBox(new BoxParser[name + "Box"]());
    };
    BoxParser.Box.prototype.addBox = function(box2) {
      this.boxes.push(box2);
      if (this[box2.type + "s"]) {
        this[box2.type + "s"].push(box2);
      } else {
        this[box2.type] = box2;
      }
      return box2;
    };
    BoxParser.Box.prototype.set = function(prop, value) {
      this[prop] = value;
      return this;
    };
    BoxParser.Box.prototype.addEntry = function(value, _prop) {
      var prop = _prop || "entries";
      if (!this[prop]) {
        this[prop] = [];
      }
      this[prop].push(value);
      return this;
    };
    if (typeof exports !== "undefined") {
      exports.BoxParser = BoxParser;
    }
    BoxParser.parseUUID = function(stream) {
      return BoxParser.parseHex16(stream);
    };
    BoxParser.parseHex16 = function(stream) {
      var hex16 = "";
      for (var i2 = 0; i2 < 16; i2++) {
        var hex = stream.readUint8().toString(16);
        hex16 += hex.length === 1 ? "0" + hex : hex;
      }
      return hex16;
    };
    BoxParser.parseOneBox = function(stream, headerOnly, parentSize) {
      var box2;
      var start = stream.getPosition();
      var hdr_size = 0;
      var diff;
      var uuid;
      if (stream.getEndPosition() - start < 8) {
        Log.debug("BoxParser", "Not enough data in stream to parse the type and size of the box");
        return { code: BoxParser.ERR_NOT_ENOUGH_DATA };
      }
      if (parentSize && parentSize < 8) {
        Log.debug("BoxParser", "Not enough bytes left in the parent box to parse a new box");
        return { code: BoxParser.ERR_NOT_ENOUGH_DATA };
      }
      var size = stream.readUint32();
      var type = stream.readString(4);
      var box_type = type;
      Log.debug("BoxParser", "Found box of type '" + type + "' and size " + size + " at position " + start);
      hdr_size = 8;
      if (type == "uuid") {
        if (stream.getEndPosition() - stream.getPosition() < 16 || parentSize - hdr_size < 16) {
          stream.seek(start);
          Log.debug("BoxParser", "Not enough bytes left in the parent box to parse a UUID box");
          return { code: BoxParser.ERR_NOT_ENOUGH_DATA };
        }
        uuid = BoxParser.parseUUID(stream);
        hdr_size += 16;
        box_type = uuid;
      }
      if (size == 1) {
        if (stream.getEndPosition() - stream.getPosition() < 8 || parentSize && parentSize - hdr_size < 8) {
          stream.seek(start);
          Log.warn("BoxParser", 'Not enough data in stream to parse the extended size of the "' + type + '" box');
          return { code: BoxParser.ERR_NOT_ENOUGH_DATA };
        }
        size = stream.readUint64();
        hdr_size += 8;
      } else if (size === 0) {
        if (parentSize) {
          size = parentSize;
        } else {
          if (type !== "mdat") {
            Log.error("BoxParser", "Unlimited box size not supported for type: '" + type + "'");
            box2 = new BoxParser.Box(type, size);
            return { code: BoxParser.OK, box: box2, size: box2.size };
          }
        }
      }
      if (size !== 0 && size < hdr_size) {
        Log.error("BoxParser", "Box of type " + type + " has an invalid size " + size + " (too small to be a box)");
        return { code: BoxParser.ERR_NOT_ENOUGH_DATA, type, size, hdr_size, start };
      }
      if (size !== 0 && parentSize && size > parentSize) {
        Log.error("BoxParser", "Box of type '" + type + "' has a size " + size + " greater than its container size " + parentSize);
        return { code: BoxParser.ERR_NOT_ENOUGH_DATA, type, size, hdr_size, start };
      }
      if (size !== 0 && start + size > stream.getEndPosition()) {
        stream.seek(start);
        Log.info("BoxParser", "Not enough data in stream to parse the entire '" + type + "' box");
        return { code: BoxParser.ERR_NOT_ENOUGH_DATA, type, size, hdr_size, start };
      }
      if (headerOnly) {
        return { code: BoxParser.OK, type, size, hdr_size, start };
      } else {
        if (BoxParser[type + "Box"]) {
          box2 = new BoxParser[type + "Box"](size);
        } else {
          if (type !== "uuid") {
            Log.warn("BoxParser", "Unknown box type: '" + type + "'");
            box2 = new BoxParser.Box(type, size);
            box2.has_unparsed_data = true;
          } else {
            if (BoxParser.UUIDBoxes[uuid]) {
              box2 = new BoxParser.UUIDBoxes[uuid](size);
            } else {
              Log.warn("BoxParser", "Unknown uuid type: '" + uuid + "'");
              box2 = new BoxParser.Box(type, size);
              box2.uuid = uuid;
              box2.has_unparsed_data = true;
            }
          }
        }
      }
      box2.hdr_size = hdr_size;
      box2.start = start;
      if (box2.write === BoxParser.Box.prototype.write && box2.type !== "mdat") {
        Log.info("BoxParser", "'" + box_type + "' box writing not yet implemented, keeping unparsed data in memory for later write");
        box2.parseDataAndRewind(stream);
      }
      box2.parse(stream);
      diff = stream.getPosition() - (box2.start + box2.size);
      if (diff < 0) {
        Log.warn("BoxParser", "Parsing of box '" + box_type + "' did not read the entire indicated box data size (missing " + -diff + " bytes), seeking forward");
        stream.seek(box2.start + box2.size);
      } else if (diff > 0) {
        Log.error("BoxParser", "Parsing of box '" + box_type + "' read " + diff + " more bytes than the indicated box data size, seeking backwards");
        if (box2.size !== 0) stream.seek(box2.start + box2.size);
      }
      return { code: BoxParser.OK, box: box2, size: box2.size };
    };
    BoxParser.Box.prototype.parse = function(stream) {
      if (this.type != "mdat") {
        this.data = stream.readUint8Array(this.size - this.hdr_size);
      } else {
        if (this.size === 0) {
          stream.seek(stream.getEndPosition());
        } else {
          stream.seek(this.start + this.size);
        }
      }
    };
    BoxParser.Box.prototype.parseDataAndRewind = function(stream) {
      this.data = stream.readUint8Array(this.size - this.hdr_size);
      stream.position -= this.size - this.hdr_size;
    };
    BoxParser.FullBox.prototype.parseDataAndRewind = function(stream) {
      this.parseFullHeader(stream);
      this.data = stream.readUint8Array(this.size - this.hdr_size);
      this.hdr_size -= 4;
      stream.position -= this.size - this.hdr_size;
    };
    BoxParser.FullBox.prototype.parseFullHeader = function(stream) {
      this.version = stream.readUint8();
      this.flags = stream.readUint24();
      this.hdr_size += 4;
    };
    BoxParser.FullBox.prototype.parse = function(stream) {
      this.parseFullHeader(stream);
      this.data = stream.readUint8Array(this.size - this.hdr_size);
    };
    BoxParser.ContainerBox.prototype.parse = function(stream) {
      var ret2;
      var box2;
      while (stream.getPosition() < this.start + this.size) {
        ret2 = BoxParser.parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
        if (ret2.code === BoxParser.OK) {
          box2 = ret2.box;
          this.boxes.push(box2);
          if (this.subBoxNames && this.subBoxNames.indexOf(box2.type) != -1) {
            this[this.subBoxNames[this.subBoxNames.indexOf(box2.type)] + "s"].push(box2);
          } else {
            var box_type = box2.type !== "uuid" ? box2.type : box2.uuid;
            if (this[box_type]) {
              Log.warn("Box of type " + box_type + " already stored in field of this type");
            } else {
              this[box_type] = box2;
            }
          }
        } else {
          return;
        }
      }
    };
    BoxParser.Box.prototype.parseLanguage = function(stream) {
      this.language = stream.readUint16();
      var chars = [];
      chars[0] = this.language >> 10 & 31;
      chars[1] = this.language >> 5 & 31;
      chars[2] = this.language & 31;
      this.languageString = String.fromCharCode(chars[0] + 96, chars[1] + 96, chars[2] + 96);
    };
    BoxParser.SAMPLE_ENTRY_TYPE_VISUAL = "Visual";
    BoxParser.SAMPLE_ENTRY_TYPE_AUDIO = "Audio";
    BoxParser.SAMPLE_ENTRY_TYPE_HINT = "Hint";
    BoxParser.SAMPLE_ENTRY_TYPE_METADATA = "Metadata";
    BoxParser.SAMPLE_ENTRY_TYPE_SUBTITLE = "Subtitle";
    BoxParser.SAMPLE_ENTRY_TYPE_SYSTEM = "System";
    BoxParser.SAMPLE_ENTRY_TYPE_TEXT = "Text";
    BoxParser.SampleEntry.prototype.parseHeader = function(stream) {
      stream.readUint8Array(6);
      this.data_reference_index = stream.readUint16();
      this.hdr_size += 8;
    };
    BoxParser.SampleEntry.prototype.parse = function(stream) {
      this.parseHeader(stream);
      this.data = stream.readUint8Array(this.size - this.hdr_size);
    };
    BoxParser.SampleEntry.prototype.parseDataAndRewind = function(stream) {
      this.parseHeader(stream);
      this.data = stream.readUint8Array(this.size - this.hdr_size);
      this.hdr_size -= 8;
      stream.position -= this.size - this.hdr_size;
    };
    BoxParser.SampleEntry.prototype.parseFooter = function(stream) {
      BoxParser.ContainerBox.prototype.parse.call(this, stream);
    };
    BoxParser.createMediaSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_HINT);
    BoxParser.createMediaSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_METADATA);
    BoxParser.createMediaSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_SUBTITLE);
    BoxParser.createMediaSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_SYSTEM);
    BoxParser.createMediaSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_TEXT);
    BoxParser.createMediaSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, function(stream) {
      var compressorname_length;
      this.parseHeader(stream);
      stream.readUint16();
      stream.readUint16();
      stream.readUint32Array(3);
      this.width = stream.readUint16();
      this.height = stream.readUint16();
      this.horizresolution = stream.readUint32();
      this.vertresolution = stream.readUint32();
      stream.readUint32();
      this.frame_count = stream.readUint16();
      compressorname_length = Math.min(31, stream.readUint8());
      this.compressorname = stream.readString(compressorname_length);
      if (compressorname_length < 31) {
        stream.readString(31 - compressorname_length);
      }
      this.depth = stream.readUint16();
      stream.readUint16();
      this.parseFooter(stream);
    });
    BoxParser.createMediaSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_AUDIO, function(stream) {
      this.parseHeader(stream);
      stream.readUint32Array(2);
      this.channel_count = stream.readUint16();
      this.samplesize = stream.readUint16();
      stream.readUint16();
      stream.readUint16();
      this.samplerate = stream.readUint32() / (1 << 16);
      this.parseFooter(stream);
    });
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "avc1");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "avc2");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "avc3");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "avc4");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "av01");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "dav1");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "hvc1");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "hev1");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "hvt1");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "lhe1");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "dvh1");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "dvhe");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "vvc1");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "vvi1");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "vvs1");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "vvcN");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "vp08");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "vp09");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "avs3");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "j2ki");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "mjp2");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "mjpg");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "uncv");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_AUDIO, "mp4a");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_AUDIO, "ac-3");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_AUDIO, "ac-4");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_AUDIO, "ec-3");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_AUDIO, "Opus");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_AUDIO, "mha1");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_AUDIO, "mha2");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_AUDIO, "mhm1");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_AUDIO, "mhm2");
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_AUDIO, "fLaC");
    BoxParser.createEncryptedSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_VISUAL, "encv");
    BoxParser.createEncryptedSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_AUDIO, "enca");
    BoxParser.createEncryptedSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_SUBTITLE, "encu");
    BoxParser.createEncryptedSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_SYSTEM, "encs");
    BoxParser.createEncryptedSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_TEXT, "enct");
    BoxParser.createEncryptedSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_METADATA, "encm");
    BoxParser.createBoxCtor("a1lx", function(stream) {
      var large_size = stream.readUint8() & 1;
      var FieldLength = ((large_size & 1) + 1) * 16;
      this.layer_size = [];
      for (var i2 = 0; i2 < 3; i2++) {
        if (FieldLength == 16) {
          this.layer_size[i2] = stream.readUint16();
        } else {
          this.layer_size[i2] = stream.readUint32();
        }
      }
    });
    BoxParser.createBoxCtor("a1op", function(stream) {
      this.op_index = stream.readUint8();
    });
    BoxParser.createFullBoxCtor("auxC", function(stream) {
      this.aux_type = stream.readCString();
      var aux_subtype_length = this.size - this.hdr_size - (this.aux_type.length + 1);
      this.aux_subtype = stream.readUint8Array(aux_subtype_length);
    });
    BoxParser.createBoxCtor("av1C", function(stream) {
      var i2;
      var toparse;
      var tmp = stream.readUint8();
      if (tmp >> 7 & false) {
        Log.error("av1C marker problem");
        return;
      }
      this.version = tmp & 127;
      if (this.version !== 1) {
        Log.error("av1C version " + this.version + " not supported");
        return;
      }
      tmp = stream.readUint8();
      this.seq_profile = tmp >> 5 & 7;
      this.seq_level_idx_0 = tmp & 31;
      tmp = stream.readUint8();
      this.seq_tier_0 = tmp >> 7 & 1;
      this.high_bitdepth = tmp >> 6 & 1;
      this.twelve_bit = tmp >> 5 & 1;
      this.monochrome = tmp >> 4 & 1;
      this.chroma_subsampling_x = tmp >> 3 & 1;
      this.chroma_subsampling_y = tmp >> 2 & 1;
      this.chroma_sample_position = tmp & 3;
      tmp = stream.readUint8();
      this.reserved_1 = tmp >> 5 & 7;
      if (this.reserved_1 !== 0) {
        Log.error("av1C reserved_1 parsing problem");
        return;
      }
      this.initial_presentation_delay_present = tmp >> 4 & 1;
      if (this.initial_presentation_delay_present === 1) {
        this.initial_presentation_delay_minus_one = tmp & 15;
      } else {
        this.reserved_2 = tmp & 15;
        if (this.reserved_2 !== 0) {
          Log.error("av1C reserved_2 parsing problem");
          return;
        }
      }
      var configOBUs_length = this.size - this.hdr_size - 4;
      this.configOBUs = stream.readUint8Array(configOBUs_length);
    });
    BoxParser.createBoxCtor("avcC", function(stream) {
      var i2;
      var toparse;
      this.configurationVersion = stream.readUint8();
      this.AVCProfileIndication = stream.readUint8();
      this.profile_compatibility = stream.readUint8();
      this.AVCLevelIndication = stream.readUint8();
      this.lengthSizeMinusOne = stream.readUint8() & 3;
      this.nb_SPS_nalus = stream.readUint8() & 31;
      toparse = this.size - this.hdr_size - 6;
      this.SPS = [];
      for (i2 = 0; i2 < this.nb_SPS_nalus; i2++) {
        this.SPS[i2] = {};
        this.SPS[i2].length = stream.readUint16();
        this.SPS[i2].nalu = stream.readUint8Array(this.SPS[i2].length);
        toparse -= 2 + this.SPS[i2].length;
      }
      this.nb_PPS_nalus = stream.readUint8();
      toparse--;
      this.PPS = [];
      for (i2 = 0; i2 < this.nb_PPS_nalus; i2++) {
        this.PPS[i2] = {};
        this.PPS[i2].length = stream.readUint16();
        this.PPS[i2].nalu = stream.readUint8Array(this.PPS[i2].length);
        toparse -= 2 + this.PPS[i2].length;
      }
      if (toparse > 0) {
        this.ext = stream.readUint8Array(toparse);
      }
    });
    BoxParser.createBoxCtor("btrt", function(stream) {
      this.bufferSizeDB = stream.readUint32();
      this.maxBitrate = stream.readUint32();
      this.avgBitrate = stream.readUint32();
    });
    BoxParser.createFullBoxCtor("ccst", function(stream) {
      var flags = stream.readUint8();
      this.all_ref_pics_intra = (flags & 128) == 128;
      this.intra_pred_used = (flags & 64) == 64;
      this.max_ref_per_pic = (flags & 63) >> 2;
      stream.readUint24();
    });
    BoxParser.createBoxCtor("cdef", function(stream) {
      var i2;
      this.channel_count = stream.readUint16();
      this.channel_indexes = [];
      this.channel_types = [];
      this.channel_associations = [];
      for (i2 = 0; i2 < this.channel_count; i2++) {
        this.channel_indexes.push(stream.readUint16());
        this.channel_types.push(stream.readUint16());
        this.channel_associations.push(stream.readUint16());
      }
    });
    BoxParser.createBoxCtor("clap", function(stream) {
      this.cleanApertureWidthN = stream.readUint32();
      this.cleanApertureWidthD = stream.readUint32();
      this.cleanApertureHeightN = stream.readUint32();
      this.cleanApertureHeightD = stream.readUint32();
      this.horizOffN = stream.readUint32();
      this.horizOffD = stream.readUint32();
      this.vertOffN = stream.readUint32();
      this.vertOffD = stream.readUint32();
    });
    BoxParser.createBoxCtor("clli", function(stream) {
      this.max_content_light_level = stream.readUint16();
      this.max_pic_average_light_level = stream.readUint16();
    });
    BoxParser.createFullBoxCtor("cmex", function(stream) {
      if (this.flags & 1) {
        this.pos_x = stream.readInt32();
      }
      if (this.flags & 2) {
        this.pos_y = stream.readInt32();
      }
      if (this.flags & 4) {
        this.pos_z = stream.readInt32();
      }
      if (this.flags & 8) {
        if (this.version == 0) {
          if (this.flags & 16) {
            this.quat_x = stream.readInt32();
            this.quat_y = stream.readInt32();
            this.quat_z = stream.readInt32();
          } else {
            this.quat_x = stream.readInt16();
            this.quat_y = stream.readInt16();
            this.quat_z = stream.readInt16();
          }
        } else if (this.version == 1) {
        }
      }
      if (this.flags & 32) {
        this.id = stream.readUint32();
      }
    });
    BoxParser.createFullBoxCtor("cmin", function(stream) {
      this.focal_length_x = stream.readInt32();
      this.principal_point_x = stream.readInt32();
      this.principal_point_y = stream.readInt32();
      if (this.flags & 1) {
        this.focal_length_y = stream.readInt32();
        this.skew_factor = stream.readInt32();
      }
    });
    BoxParser.createBoxCtor("cmpd", function(stream) {
      this.component_count = stream.readUint32();
      this.component_types = [];
      this.component_type_urls = [];
      for (i = 0; i < this.component_count; i++) {
        var component_type = stream.readUint16();
        this.component_types.push(component_type);
        if (component_type >= 32768) {
          this.component_type_urls.push(stream.readCString());
        }
      }
    });
    BoxParser.createFullBoxCtor("co64", function(stream) {
      var entry_count2;
      var i2;
      entry_count2 = stream.readUint32();
      this.chunk_offsets = [];
      if (this.version === 0) {
        for (i2 = 0; i2 < entry_count2; i2++) {
          this.chunk_offsets.push(stream.readUint64());
        }
      }
    });
    BoxParser.createFullBoxCtor("CoLL", function(stream) {
      this.maxCLL = stream.readUint16();
      this.maxFALL = stream.readUint16();
    });
    BoxParser.createBoxCtor("colr", function(stream) {
      this.colour_type = stream.readString(4);
      if (this.colour_type === "nclx") {
        this.colour_primaries = stream.readUint16();
        this.transfer_characteristics = stream.readUint16();
        this.matrix_coefficients = stream.readUint16();
        var tmp = stream.readUint8();
        this.full_range_flag = tmp >> 7;
      } else if (this.colour_type === "rICC") {
        this.ICC_profile = stream.readUint8Array(this.size - 4);
      } else if (this.colour_type === "prof") {
        this.ICC_profile = stream.readUint8Array(this.size - 4);
      }
    });
    BoxParser.createFullBoxCtor("cprt", function(stream) {
      this.parseLanguage(stream);
      this.notice = stream.readCString();
    });
    BoxParser.createFullBoxCtor("cslg", function(stream) {
      var entry_count2;
      if (this.version === 0) {
        this.compositionToDTSShift = stream.readInt32();
        this.leastDecodeToDisplayDelta = stream.readInt32();
        this.greatestDecodeToDisplayDelta = stream.readInt32();
        this.compositionStartTime = stream.readInt32();
        this.compositionEndTime = stream.readInt32();
      }
    });
    BoxParser.createFullBoxCtor("ctts", function(stream) {
      var entry_count2;
      var i2;
      entry_count2 = stream.readUint32();
      this.sample_counts = [];
      this.sample_offsets = [];
      if (this.version === 0) {
        for (i2 = 0; i2 < entry_count2; i2++) {
          this.sample_counts.push(stream.readUint32());
          var value = stream.readInt32();
          if (value < 0) {
            Log.warn("BoxParser", "ctts box uses negative values without using version 1");
          }
          this.sample_offsets.push(value);
        }
      } else if (this.version == 1) {
        for (i2 = 0; i2 < entry_count2; i2++) {
          this.sample_counts.push(stream.readUint32());
          this.sample_offsets.push(stream.readInt32());
        }
      }
    });
    BoxParser.createBoxCtor("dac3", function(stream) {
      var tmp_byte1 = stream.readUint8();
      var tmp_byte2 = stream.readUint8();
      var tmp_byte3 = stream.readUint8();
      this.fscod = tmp_byte1 >> 6;
      this.bsid = tmp_byte1 >> 1 & 31;
      this.bsmod = (tmp_byte1 & 1) << 2 | tmp_byte2 >> 6 & 3;
      this.acmod = tmp_byte2 >> 3 & 7;
      this.lfeon = tmp_byte2 >> 2 & 1;
      this.bit_rate_code = tmp_byte2 & 3 | tmp_byte3 >> 5 & 7;
    });
    BoxParser.createBoxCtor("dec3", function(stream) {
      var tmp_16 = stream.readUint16();
      this.data_rate = tmp_16 >> 3;
      this.num_ind_sub = tmp_16 & 7;
      this.ind_subs = [];
      for (var i2 = 0; i2 < this.num_ind_sub + 1; i2++) {
        var ind_sub = {};
        this.ind_subs.push(ind_sub);
        var tmp_byte1 = stream.readUint8();
        var tmp_byte2 = stream.readUint8();
        var tmp_byte3 = stream.readUint8();
        ind_sub.fscod = tmp_byte1 >> 6;
        ind_sub.bsid = tmp_byte1 >> 1 & 31;
        ind_sub.bsmod = (tmp_byte1 & 1) << 4 | tmp_byte2 >> 4 & 15;
        ind_sub.acmod = tmp_byte2 >> 1 & 7;
        ind_sub.lfeon = tmp_byte2 & 1;
        ind_sub.num_dep_sub = tmp_byte3 >> 1 & 15;
        if (ind_sub.num_dep_sub > 0) {
          ind_sub.chan_loc = (tmp_byte3 & 1) << 8 | stream.readUint8();
        }
      }
    });
    BoxParser.createFullBoxCtor("dfLa", function(stream) {
      var BLOCKTYPE_MASK = 127;
      var LASTMETADATABLOCKFLAG_MASK = 128;
      var boxesFound = [];
      var knownBlockTypes = [
        "STREAMINFO",
        "PADDING",
        "APPLICATION",
        "SEEKTABLE",
        "VORBIS_COMMENT",
        "CUESHEET",
        "PICTURE",
        "RESERVED"
      ];
      do {
        var flagAndType = stream.readUint8();
        var type = Math.min(
          flagAndType & BLOCKTYPE_MASK,
          knownBlockTypes.length - 1
        );
        if (!type) {
          stream.readUint8Array(13);
          this.samplerate = stream.readUint32() >> 12;
          stream.readUint8Array(20);
        } else {
          stream.readUint8Array(stream.readUint24());
        }
        boxesFound.push(knownBlockTypes[type]);
        if (!!(flagAndType & LASTMETADATABLOCKFLAG_MASK)) {
          break;
        }
      } while (true);
      this.numMetadataBlocks = boxesFound.length + " (" + boxesFound.join(", ") + ")";
    });
    BoxParser.createBoxCtor("dimm", function(stream) {
      this.bytessent = stream.readUint64();
    });
    BoxParser.createBoxCtor("dmax", function(stream) {
      this.time = stream.readUint32();
    });
    BoxParser.createBoxCtor("dmed", function(stream) {
      this.bytessent = stream.readUint64();
    });
    BoxParser.createBoxCtor("dOps", function(stream) {
      this.Version = stream.readUint8();
      this.OutputChannelCount = stream.readUint8();
      this.PreSkip = stream.readUint16();
      this.InputSampleRate = stream.readUint32();
      this.OutputGain = stream.readInt16();
      this.ChannelMappingFamily = stream.readUint8();
      if (this.ChannelMappingFamily !== 0) {
        this.StreamCount = stream.readUint8();
        this.CoupledCount = stream.readUint8();
        this.ChannelMapping = [];
        for (var i2 = 0; i2 < this.OutputChannelCount; i2++) {
          this.ChannelMapping[i2] = stream.readUint8();
        }
      }
    });
    BoxParser.createFullBoxCtor("dref", function(stream) {
      var ret2;
      var box2;
      this.entries = [];
      var entry_count2 = stream.readUint32();
      for (var i2 = 0; i2 < entry_count2; i2++) {
        ret2 = BoxParser.parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
        if (ret2.code === BoxParser.OK) {
          box2 = ret2.box;
          this.entries.push(box2);
        } else {
          return;
        }
      }
    });
    BoxParser.createBoxCtor("drep", function(stream) {
      this.bytessent = stream.readUint64();
    });
    BoxParser.createFullBoxCtor("elng", function(stream) {
      this.extended_language = stream.readString(this.size - this.hdr_size);
    });
    BoxParser.createFullBoxCtor("elst", function(stream) {
      this.entries = [];
      var entry_count2 = stream.readUint32();
      for (var i2 = 0; i2 < entry_count2; i2++) {
        var entry = {};
        this.entries.push(entry);
        if (this.version === 1) {
          entry.segment_duration = stream.readUint64();
          entry.media_time = stream.readInt64();
        } else {
          entry.segment_duration = stream.readUint32();
          entry.media_time = stream.readInt32();
        }
        entry.media_rate_integer = stream.readInt16();
        entry.media_rate_fraction = stream.readInt16();
      }
    });
    BoxParser.createFullBoxCtor("emsg", function(stream) {
      if (this.version == 1) {
        this.timescale = stream.readUint32();
        this.presentation_time = stream.readUint64();
        this.event_duration = stream.readUint32();
        this.id = stream.readUint32();
        this.scheme_id_uri = stream.readCString();
        this.value = stream.readCString();
      } else {
        this.scheme_id_uri = stream.readCString();
        this.value = stream.readCString();
        this.timescale = stream.readUint32();
        this.presentation_time_delta = stream.readUint32();
        this.event_duration = stream.readUint32();
        this.id = stream.readUint32();
      }
      var message_size = this.size - this.hdr_size - (4 * 4 + (this.scheme_id_uri.length + 1) + (this.value.length + 1));
      if (this.version == 1) {
        message_size -= 4;
      }
      this.message_data = stream.readUint8Array(message_size);
    });
    BoxParser.createEntityToGroupCtor = function(type, parseMethod) {
      BoxParser[type + "Box"] = function(size) {
        BoxParser.FullBox.call(this, type, size);
      };
      BoxParser[type + "Box"].prototype = new BoxParser.FullBox();
      BoxParser[type + "Box"].prototype.parse = function(stream) {
        this.parseFullHeader(stream);
        if (parseMethod) {
          parseMethod.call(this, stream);
        } else {
          this.group_id = stream.readUint32();
          this.num_entities_in_group = stream.readUint32();
          this.entity_ids = [];
          for (i = 0; i < this.num_entities_in_group; i++) {
            var entity_id = stream.readUint32();
            this.entity_ids.push(entity_id);
          }
        }
      };
    };
    BoxParser.createEntityToGroupCtor("aebr");
    BoxParser.createEntityToGroupCtor("afbr");
    BoxParser.createEntityToGroupCtor("albc");
    BoxParser.createEntityToGroupCtor("altr");
    BoxParser.createEntityToGroupCtor("brst");
    BoxParser.createEntityToGroupCtor("dobr");
    BoxParser.createEntityToGroupCtor("eqiv");
    BoxParser.createEntityToGroupCtor("favc");
    BoxParser.createEntityToGroupCtor("fobr");
    BoxParser.createEntityToGroupCtor("iaug");
    BoxParser.createEntityToGroupCtor("pano");
    BoxParser.createEntityToGroupCtor("slid");
    BoxParser.createEntityToGroupCtor("ster");
    BoxParser.createEntityToGroupCtor("tsyn");
    BoxParser.createEntityToGroupCtor("wbbr");
    BoxParser.createEntityToGroupCtor("prgr");
    BoxParser.createEntityToGroupCtor("pymd", function(stream) {
      this.group_id = stream.readUint32();
      this.num_entities_in_group = stream.readUint32();
      this.entity_ids = [];
      for (var i2 = 0; i2 < this.num_entities_in_group; i2++) {
        var entity_id = stream.readUint32();
        this.entity_ids.push(entity_id);
      }
      this.tile_size_x = stream.readUint16();
      this.tile_size_y = stream.readUint16();
      this.layer_binning = [];
      this.tiles_in_layer_column_minus1 = [];
      this.tiles_in_layer_row_minus1 = [];
      for (i2 = 0; i2 < this.num_entities_in_group; i2++) {
        this.layer_binning[i2] = stream.readUint16();
        this.tiles_in_layer_row_minus1[i2] = stream.readUint16();
        this.tiles_in_layer_column_minus1[i2] = stream.readUint16();
      }
    });
    BoxParser.createFullBoxCtor("esds", function(stream) {
      var esd_data = stream.readUint8Array(this.size - this.hdr_size);
      this.data = esd_data;
      if (typeof MPEG4DescriptorParser !== "undefined") {
        var esd_parser = new MPEG4DescriptorParser();
        this.esd = esd_parser.parseOneDescriptor(new DataStream(esd_data.buffer, 0, DataStream.BIG_ENDIAN));
      }
    });
    BoxParser.createBoxCtor("fiel", function(stream) {
      this.fieldCount = stream.readUint8();
      this.fieldOrdering = stream.readUint8();
    });
    BoxParser.createBoxCtor("frma", function(stream) {
      this.data_format = stream.readString(4);
    });
    BoxParser.createBoxCtor("ftyp", function(stream) {
      var toparse = this.size - this.hdr_size;
      this.major_brand = stream.readString(4);
      this.minor_version = stream.readUint32();
      toparse -= 8;
      this.compatible_brands = [];
      var i2 = 0;
      while (toparse >= 4) {
        this.compatible_brands[i2] = stream.readString(4);
        toparse -= 4;
        i2++;
      }
    });
    BoxParser.createFullBoxCtor("hdlr", function(stream) {
      if (this.version === 0) {
        stream.readUint32();
        this.handler = stream.readString(4);
        stream.readUint32Array(3);
        this.name = stream.readString(this.size - this.hdr_size - 20);
        if (this.name[this.name.length - 1] === "\0") {
          this.name = this.name.slice(0, -1);
        }
      }
    });
    BoxParser.createBoxCtor("hvcC", function(stream) {
      var i2, j2;
      var nb_nalus;
      var length;
      var tmp_byte;
      this.configurationVersion = stream.readUint8();
      tmp_byte = stream.readUint8();
      this.general_profile_space = tmp_byte >> 6;
      this.general_tier_flag = (tmp_byte & 32) >> 5;
      this.general_profile_idc = tmp_byte & 31;
      this.general_profile_compatibility = stream.readUint32();
      this.general_constraint_indicator = stream.readUint8Array(6);
      this.general_level_idc = stream.readUint8();
      this.min_spatial_segmentation_idc = stream.readUint16() & 4095;
      this.parallelismType = stream.readUint8() & 3;
      this.chroma_format_idc = stream.readUint8() & 3;
      this.bit_depth_luma_minus8 = stream.readUint8() & 7;
      this.bit_depth_chroma_minus8 = stream.readUint8() & 7;
      this.avgFrameRate = stream.readUint16();
      tmp_byte = stream.readUint8();
      this.constantFrameRate = tmp_byte >> 6;
      this.numTemporalLayers = (tmp_byte & 13) >> 3;
      this.temporalIdNested = (tmp_byte & 4) >> 2;
      this.lengthSizeMinusOne = tmp_byte & 3;
      this.nalu_arrays = [];
      var numOfArrays = stream.readUint8();
      for (i2 = 0; i2 < numOfArrays; i2++) {
        var nalu_array = [];
        this.nalu_arrays.push(nalu_array);
        tmp_byte = stream.readUint8();
        nalu_array.completeness = (tmp_byte & 128) >> 7;
        nalu_array.nalu_type = tmp_byte & 63;
        var numNalus = stream.readUint16();
        for (j2 = 0; j2 < numNalus; j2++) {
          var nalu = {};
          nalu_array.push(nalu);
          length = stream.readUint16();
          nalu.data = stream.readUint8Array(length);
        }
      }
    });
    BoxParser.createFullBoxCtor("iinf", function(stream) {
      var ret2;
      if (this.version === 0) {
        this.entry_count = stream.readUint16();
      } else {
        this.entry_count = stream.readUint32();
      }
      this.item_infos = [];
      for (var i2 = 0; i2 < this.entry_count; i2++) {
        ret2 = BoxParser.parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
        if (ret2.code === BoxParser.OK) {
          if (ret2.box.type !== "infe") {
            Log.error("BoxParser", "Expected 'infe' box, got " + ret2.box.type);
          }
          this.item_infos[i2] = ret2.box;
        } else {
          return;
        }
      }
    });
    BoxParser.createFullBoxCtor("iloc", function(stream) {
      var byte;
      byte = stream.readUint8();
      this.offset_size = byte >> 4 & 15;
      this.length_size = byte & 15;
      byte = stream.readUint8();
      this.base_offset_size = byte >> 4 & 15;
      if (this.version === 1 || this.version === 2) {
        this.index_size = byte & 15;
      } else {
        this.index_size = 0;
      }
      this.items = [];
      var item_count = 0;
      if (this.version < 2) {
        item_count = stream.readUint16();
      } else if (this.version === 2) {
        item_count = stream.readUint32();
      } else {
        throw "version of iloc box not supported";
      }
      for (var i2 = 0; i2 < item_count; i2++) {
        var item = {};
        this.items.push(item);
        if (this.version < 2) {
          item.item_ID = stream.readUint16();
        } else if (this.version === 2) {
          item.item_ID = stream.readUint32();
        } else {
          throw "version of iloc box not supported";
        }
        if (this.version === 1 || this.version === 2) {
          item.construction_method = stream.readUint16() & 15;
        } else {
          item.construction_method = 0;
        }
        item.data_reference_index = stream.readUint16();
        switch (this.base_offset_size) {
          case 0:
            item.base_offset = 0;
            break;
          case 4:
            item.base_offset = stream.readUint32();
            break;
          case 8:
            item.base_offset = stream.readUint64();
            break;
          default:
            throw "Error reading base offset size";
        }
        var extent_count = stream.readUint16();
        item.extents = [];
        for (var j2 = 0; j2 < extent_count; j2++) {
          var extent = {};
          item.extents.push(extent);
          if (this.version === 1 || this.version === 2) {
            switch (this.index_size) {
              case 0:
                extent.extent_index = 0;
                break;
              case 4:
                extent.extent_index = stream.readUint32();
                break;
              case 8:
                extent.extent_index = stream.readUint64();
                break;
              default:
                throw "Error reading extent index";
            }
          }
          switch (this.offset_size) {
            case 0:
              extent.extent_offset = 0;
              break;
            case 4:
              extent.extent_offset = stream.readUint32();
              break;
            case 8:
              extent.extent_offset = stream.readUint64();
              break;
            default:
              throw "Error reading extent index";
          }
          switch (this.length_size) {
            case 0:
              extent.extent_length = 0;
              break;
            case 4:
              extent.extent_length = stream.readUint32();
              break;
            case 8:
              extent.extent_length = stream.readUint64();
              break;
            default:
              throw "Error reading extent index";
          }
        }
      }
    });
    BoxParser.createBoxCtor("imir", function(stream) {
      var tmp = stream.readUint8();
      this.reserved = tmp >> 7;
      this.axis = tmp & 1;
    });
    BoxParser.createFullBoxCtor("infe", function(stream) {
      if (this.version === 0 || this.version === 1) {
        this.item_ID = stream.readUint16();
        this.item_protection_index = stream.readUint16();
        this.item_name = stream.readCString();
        this.content_type = stream.readCString();
        this.content_encoding = stream.readCString();
      }
      if (this.version === 1) {
        this.extension_type = stream.readString(4);
        Log.warn("BoxParser", "Cannot parse extension type");
        stream.seek(this.start + this.size);
        return;
      }
      if (this.version >= 2) {
        if (this.version === 2) {
          this.item_ID = stream.readUint16();
        } else if (this.version === 3) {
          this.item_ID = stream.readUint32();
        }
        this.item_protection_index = stream.readUint16();
        this.item_type = stream.readString(4);
        this.item_name = stream.readCString();
        if (this.item_type === "mime") {
          this.content_type = stream.readCString();
          this.content_encoding = stream.readCString();
        } else if (this.item_type === "uri ") {
          this.item_uri_type = stream.readCString();
        }
      }
    });
    BoxParser.createFullBoxCtor("ipma", function(stream) {
      var i2, j2;
      entry_count = stream.readUint32();
      this.associations = [];
      for (i2 = 0; i2 < entry_count; i2++) {
        var item_assoc = {};
        this.associations.push(item_assoc);
        if (this.version < 1) {
          item_assoc.id = stream.readUint16();
        } else {
          item_assoc.id = stream.readUint32();
        }
        var association_count = stream.readUint8();
        item_assoc.props = [];
        for (j2 = 0; j2 < association_count; j2++) {
          var tmp = stream.readUint8();
          var p2 = {};
          item_assoc.props.push(p2);
          p2.essential = (tmp & 128) >> 7 === 1;
          if (this.flags & 1) {
            p2.property_index = (tmp & 127) << 8 | stream.readUint8();
          } else {
            p2.property_index = tmp & 127;
          }
        }
      }
    });
    BoxParser.createFullBoxCtor("iref", function(stream) {
      var ret2;
      var entryCount;
      var box2;
      this.references = [];
      while (stream.getPosition() < this.start + this.size) {
        ret2 = BoxParser.parseOneBox(stream, true, this.size - (stream.getPosition() - this.start));
        if (ret2.code === BoxParser.OK) {
          if (this.version === 0) {
            box2 = new BoxParser.SingleItemTypeReferenceBox(ret2.type, ret2.size, ret2.hdr_size, ret2.start);
          } else {
            box2 = new BoxParser.SingleItemTypeReferenceBoxLarge(ret2.type, ret2.size, ret2.hdr_size, ret2.start);
          }
          if (box2.write === BoxParser.Box.prototype.write && box2.type !== "mdat") {
            Log.warn("BoxParser", box2.type + " box writing not yet implemented, keeping unparsed data in memory for later write");
            box2.parseDataAndRewind(stream);
          }
          box2.parse(stream);
          this.references.push(box2);
        } else {
          return;
        }
      }
    });
    BoxParser.createBoxCtor("irot", function(stream) {
      this.angle = stream.readUint8() & 3;
    });
    BoxParser.createFullBoxCtor("ispe", function(stream) {
      this.image_width = stream.readUint32();
      this.image_height = stream.readUint32();
    });
    BoxParser.createFullBoxCtor("kind", function(stream) {
      this.schemeURI = stream.readCString();
      this.value = stream.readCString();
    });
    BoxParser.createFullBoxCtor("leva", function(stream) {
      var count = stream.readUint8();
      this.levels = [];
      for (var i2 = 0; i2 < count; i2++) {
        var level = {};
        this.levels[i2] = level;
        level.track_ID = stream.readUint32();
        var tmp_byte = stream.readUint8();
        level.padding_flag = tmp_byte >> 7;
        level.assignment_type = tmp_byte & 127;
        switch (level.assignment_type) {
          case 0:
            level.grouping_type = stream.readString(4);
            break;
          case 1:
            level.grouping_type = stream.readString(4);
            level.grouping_type_parameter = stream.readUint32();
            break;
          case 2:
            break;
          case 3:
            break;
          case 4:
            level.sub_track_id = stream.readUint32();
            break;
          default:
            Log.warn("BoxParser", "Unknown leva assignement type");
        }
      }
    });
    BoxParser.createBoxCtor("lhvC", function(stream) {
      var i2, j2;
      var tmp_byte;
      this.configurationVersion = stream.readUint8();
      this.min_spatial_segmentation_idc = stream.readUint16() & 4095;
      this.parallelismType = stream.readUint8() & 3;
      tmp_byte = stream.readUint8();
      this.numTemporalLayers = (tmp_byte & 13) >> 3;
      this.temporalIdNested = (tmp_byte & 4) >> 2;
      this.lengthSizeMinusOne = tmp_byte & 3;
      this.nalu_arrays = [];
      var numOfArrays = stream.readUint8();
      for (i2 = 0; i2 < numOfArrays; i2++) {
        var nalu_array = [];
        this.nalu_arrays.push(nalu_array);
        tmp_byte = stream.readUint8();
        nalu_array.completeness = (tmp_byte & 128) >> 7;
        nalu_array.nalu_type = tmp_byte & 63;
        var numNalus = stream.readUint16();
        for (j2 = 0; j2 < numNalus; j2++) {
          var nalu = {};
          nalu_array.push(nalu);
          var length = stream.readUint16();
          nalu.data = stream.readUint8Array(length);
        }
      }
    });
    BoxParser.createBoxCtor("lsel", function(stream) {
      this.layer_id = stream.readUint16();
    });
    BoxParser.createBoxCtor("maxr", function(stream) {
      this.period = stream.readUint32();
      this.bytes = stream.readUint32();
    });
    function ColorPoint(x3, y2) {
      this.x = x3;
      this.y = y2;
    }
    ColorPoint.prototype.toString = function() {
      return "(" + this.x + "," + this.y + ")";
    };
    BoxParser.createBoxCtor("mdcv", function(stream) {
      this.display_primaries = [];
      this.display_primaries[0] = new ColorPoint(stream.readUint16(), stream.readUint16());
      this.display_primaries[1] = new ColorPoint(stream.readUint16(), stream.readUint16());
      this.display_primaries[2] = new ColorPoint(stream.readUint16(), stream.readUint16());
      this.white_point = new ColorPoint(stream.readUint16(), stream.readUint16());
      this.max_display_mastering_luminance = stream.readUint32();
      this.min_display_mastering_luminance = stream.readUint32();
    });
    BoxParser.createFullBoxCtor("mdhd", function(stream) {
      if (this.version == 1) {
        this.creation_time = stream.readUint64();
        this.modification_time = stream.readUint64();
        this.timescale = stream.readUint32();
        this.duration = stream.readUint64();
      } else {
        this.creation_time = stream.readUint32();
        this.modification_time = stream.readUint32();
        this.timescale = stream.readUint32();
        this.duration = stream.readUint32();
      }
      this.parseLanguage(stream);
      stream.readUint16();
    });
    BoxParser.createFullBoxCtor("mehd", function(stream) {
      if (this.flags & 1) {
        Log.warn("BoxParser", "mehd box incorrectly uses flags set to 1, converting version to 1");
        this.version = 1;
      }
      if (this.version == 1) {
        this.fragment_duration = stream.readUint64();
      } else {
        this.fragment_duration = stream.readUint32();
      }
    });
    BoxParser.createFullBoxCtor("meta", function(stream) {
      this.boxes = [];
      BoxParser.ContainerBox.prototype.parse.call(this, stream);
    });
    BoxParser.createFullBoxCtor("mfhd", function(stream) {
      this.sequence_number = stream.readUint32();
    });
    BoxParser.createFullBoxCtor("mfro", function(stream) {
      this._size = stream.readUint32();
    });
    BoxParser.createFullBoxCtor("mskC", function(stream) {
      this.bits_per_pixel = stream.readUint8();
    });
    BoxParser.createFullBoxCtor("mvhd", function(stream) {
      if (this.version == 1) {
        this.creation_time = stream.readUint64();
        this.modification_time = stream.readUint64();
        this.timescale = stream.readUint32();
        this.duration = stream.readUint64();
      } else {
        this.creation_time = stream.readUint32();
        this.modification_time = stream.readUint32();
        this.timescale = stream.readUint32();
        this.duration = stream.readUint32();
      }
      this.rate = stream.readUint32();
      this.volume = stream.readUint16() >> 8;
      stream.readUint16();
      stream.readUint32Array(2);
      this.matrix = stream.readUint32Array(9);
      stream.readUint32Array(6);
      this.next_track_id = stream.readUint32();
    });
    BoxParser.createBoxCtor("npck", function(stream) {
      this.packetssent = stream.readUint32();
    });
    BoxParser.createBoxCtor("nump", function(stream) {
      this.packetssent = stream.readUint64();
    });
    BoxParser.createFullBoxCtor("padb", function(stream) {
      var sample_count = stream.readUint32();
      this.padbits = [];
      for (var i2 = 0; i2 < Math.floor((sample_count + 1) / 2); i2++) {
        this.padbits = stream.readUint8();
      }
    });
    BoxParser.createBoxCtor("pasp", function(stream) {
      this.hSpacing = stream.readUint32();
      this.vSpacing = stream.readUint32();
    });
    BoxParser.createBoxCtor("payl", function(stream) {
      this.text = stream.readString(this.size - this.hdr_size);
    });
    BoxParser.createBoxCtor("payt", function(stream) {
      this.payloadID = stream.readUint32();
      var count = stream.readUint8();
      this.rtpmap_string = stream.readString(count);
    });
    BoxParser.createFullBoxCtor("pdin", function(stream) {
      var count = (this.size - this.hdr_size) / 8;
      this.rate = [];
      this.initial_delay = [];
      for (var i2 = 0; i2 < count; i2++) {
        this.rate[i2] = stream.readUint32();
        this.initial_delay[i2] = stream.readUint32();
      }
    });
    BoxParser.createFullBoxCtor("pitm", function(stream) {
      if (this.version === 0) {
        this.item_id = stream.readUint16();
      } else {
        this.item_id = stream.readUint32();
      }
    });
    BoxParser.createFullBoxCtor("pixi", function(stream) {
      var i2;
      this.num_channels = stream.readUint8();
      this.bits_per_channels = [];
      for (i2 = 0; i2 < this.num_channels; i2++) {
        this.bits_per_channels[i2] = stream.readUint8();
      }
    });
    BoxParser.createBoxCtor("pmax", function(stream) {
      this.bytes = stream.readUint32();
    });
    BoxParser.createFullBoxCtor("prdi", function(stream) {
      this.step_count = stream.readUint16();
      this.item_count = [];
      if (this.flags & 2) {
        for (var i2 = 0; i2 < this.step_count; i2++) {
          this.item_count[i2] = stream.readUint16();
        }
      }
    });
    BoxParser.createFullBoxCtor("prft", function(stream) {
      this.ref_track_id = stream.readUint32();
      this.ntp_timestamp = stream.readUint64();
      if (this.version === 0) {
        this.media_time = stream.readUint32();
      } else {
        this.media_time = stream.readUint64();
      }
    });
    BoxParser.createFullBoxCtor("pssh", function(stream) {
      this.system_id = BoxParser.parseHex16(stream);
      if (this.version > 0) {
        var count = stream.readUint32();
        this.kid = [];
        for (var i2 = 0; i2 < count; i2++) {
          this.kid[i2] = BoxParser.parseHex16(stream);
        }
      }
      var datasize = stream.readUint32();
      if (datasize > 0) {
        this.data = stream.readUint8Array(datasize);
      }
    });
    BoxParser.createFullBoxCtor("clef", function(stream) {
      this.width = stream.readUint32();
      this.height = stream.readUint32();
    });
    BoxParser.createFullBoxCtor("enof", function(stream) {
      this.width = stream.readUint32();
      this.height = stream.readUint32();
    });
    BoxParser.createFullBoxCtor("prof", function(stream) {
      this.width = stream.readUint32();
      this.height = stream.readUint32();
    });
    BoxParser.createContainerBoxCtor("tapt", null, ["clef", "prof", "enof"]);
    BoxParser.createBoxCtor("rtp ", function(stream) {
      this.descriptionformat = stream.readString(4);
      this.sdptext = stream.readString(this.size - this.hdr_size - 4);
    });
    BoxParser.createFullBoxCtor("saio", function(stream) {
      if (this.flags & 1) {
        this.aux_info_type = stream.readUint32();
        this.aux_info_type_parameter = stream.readUint32();
      }
      var count = stream.readUint32();
      this.offset = [];
      for (var i2 = 0; i2 < count; i2++) {
        if (this.version === 0) {
          this.offset[i2] = stream.readUint32();
        } else {
          this.offset[i2] = stream.readUint64();
        }
      }
    });
    BoxParser.createFullBoxCtor("saiz", function(stream) {
      if (this.flags & 1) {
        this.aux_info_type = stream.readUint32();
        this.aux_info_type_parameter = stream.readUint32();
      }
      this.default_sample_info_size = stream.readUint8();
      var count = stream.readUint32();
      this.sample_info_size = [];
      if (this.default_sample_info_size === 0) {
        for (var i2 = 0; i2 < count; i2++) {
          this.sample_info_size[i2] = stream.readUint8();
        }
      }
    });
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_METADATA, "mett", function(stream) {
      this.parseHeader(stream);
      this.content_encoding = stream.readCString();
      this.mime_format = stream.readCString();
      this.parseFooter(stream);
    });
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_METADATA, "metx", function(stream) {
      this.parseHeader(stream);
      this.content_encoding = stream.readCString();
      this.namespace = stream.readCString();
      this.schema_location = stream.readCString();
      this.parseFooter(stream);
    });
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_SUBTITLE, "sbtt", function(stream) {
      this.parseHeader(stream);
      this.content_encoding = stream.readCString();
      this.mime_format = stream.readCString();
      this.parseFooter(stream);
    });
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_SUBTITLE, "stpp", function(stream) {
      this.parseHeader(stream);
      this.namespace = stream.readCString();
      this.schema_location = stream.readCString();
      this.auxiliary_mime_types = stream.readCString();
      this.parseFooter(stream);
    });
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_SUBTITLE, "stxt", function(stream) {
      this.parseHeader(stream);
      this.content_encoding = stream.readCString();
      this.mime_format = stream.readCString();
      this.parseFooter(stream);
    });
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_SUBTITLE, "tx3g", function(stream) {
      this.parseHeader(stream);
      this.displayFlags = stream.readUint32();
      this.horizontal_justification = stream.readInt8();
      this.vertical_justification = stream.readInt8();
      this.bg_color_rgba = stream.readUint8Array(4);
      this.box_record = stream.readInt16Array(4);
      this.style_record = stream.readUint8Array(12);
      this.parseFooter(stream);
    });
    BoxParser.createSampleEntryCtor(BoxParser.SAMPLE_ENTRY_TYPE_METADATA, "wvtt", function(stream) {
      this.parseHeader(stream);
      this.parseFooter(stream);
    });
    BoxParser.createSampleGroupCtor("alst", function(stream) {
      var i2;
      var roll_count = stream.readUint16();
      this.first_output_sample = stream.readUint16();
      this.sample_offset = [];
      for (i2 = 0; i2 < roll_count; i2++) {
        this.sample_offset[i2] = stream.readUint32();
      }
      var remaining = this.description_length - 4 - 4 * roll_count;
      this.num_output_samples = [];
      this.num_total_samples = [];
      for (i2 = 0; i2 < remaining / 4; i2++) {
        this.num_output_samples[i2] = stream.readUint16();
        this.num_total_samples[i2] = stream.readUint16();
      }
    });
    BoxParser.createSampleGroupCtor("avll", function(stream) {
      this.layerNumber = stream.readUint8();
      this.accurateStatisticsFlag = stream.readUint8();
      this.avgBitRate = stream.readUint16();
      this.avgFrameRate = stream.readUint16();
    });
    BoxParser.createSampleGroupCtor("avss", function(stream) {
      this.subSequenceIdentifier = stream.readUint16();
      this.layerNumber = stream.readUint8();
      var tmp_byte = stream.readUint8();
      this.durationFlag = tmp_byte >> 7;
      this.avgRateFlag = tmp_byte >> 6 & 1;
      if (this.durationFlag) {
        this.duration = stream.readUint32();
      }
      if (this.avgRateFlag) {
        this.accurateStatisticsFlag = stream.readUint8();
        this.avgBitRate = stream.readUint16();
        this.avgFrameRate = stream.readUint16();
      }
      this.dependency = [];
      var numReferences = stream.readUint8();
      for (var i2 = 0; i2 < numReferences; i2++) {
        var dependencyInfo = {};
        this.dependency.push(dependencyInfo);
        dependencyInfo.subSeqDirectionFlag = stream.readUint8();
        dependencyInfo.layerNumber = stream.readUint8();
        dependencyInfo.subSequenceIdentifier = stream.readUint16();
      }
    });
    BoxParser.createSampleGroupCtor("dtrt", function(stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    });
    BoxParser.createSampleGroupCtor("mvif", function(stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    });
    BoxParser.createSampleGroupCtor("prol", function(stream) {
      this.roll_distance = stream.readInt16();
    });
    BoxParser.createSampleGroupCtor("rap ", function(stream) {
      var tmp_byte = stream.readUint8();
      this.num_leading_samples_known = tmp_byte >> 7;
      this.num_leading_samples = tmp_byte & 127;
    });
    BoxParser.createSampleGroupCtor("rash", function(stream) {
      this.operation_point_count = stream.readUint16();
      if (this.description_length !== 2 + (this.operation_point_count === 1 ? 2 : this.operation_point_count * 6) + 9) {
        Log.warn("BoxParser", "Mismatch in " + this.grouping_type + " sample group length");
        this.data = stream.readUint8Array(this.description_length - 2);
      } else {
        if (this.operation_point_count === 1) {
          this.target_rate_share = stream.readUint16();
        } else {
          this.target_rate_share = [];
          this.available_bitrate = [];
          for (var i2 = 0; i2 < this.operation_point_count; i2++) {
            this.available_bitrate[i2] = stream.readUint32();
            this.target_rate_share[i2] = stream.readUint16();
          }
        }
        this.maximum_bitrate = stream.readUint32();
        this.minimum_bitrate = stream.readUint32();
        this.discard_priority = stream.readUint8();
      }
    });
    BoxParser.createSampleGroupCtor("roll", function(stream) {
      this.roll_distance = stream.readInt16();
    });
    BoxParser.SampleGroupEntry.prototype.parse = function(stream) {
      Log.warn("BoxParser", "Unknown Sample Group type: " + this.grouping_type);
      this.data = stream.readUint8Array(this.description_length);
    };
    BoxParser.createSampleGroupCtor("scif", function(stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    });
    BoxParser.createSampleGroupCtor("scnm", function(stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    });
    BoxParser.createSampleGroupCtor("seig", function(stream) {
      this.reserved = stream.readUint8();
      var tmp = stream.readUint8();
      this.crypt_byte_block = tmp >> 4;
      this.skip_byte_block = tmp & 15;
      this.isProtected = stream.readUint8();
      this.Per_Sample_IV_Size = stream.readUint8();
      this.KID = BoxParser.parseHex16(stream);
      this.constant_IV_size = 0;
      this.constant_IV = 0;
      if (this.isProtected === 1 && this.Per_Sample_IV_Size === 0) {
        this.constant_IV_size = stream.readUint8();
        this.constant_IV = stream.readUint8Array(this.constant_IV_size);
      }
    });
    BoxParser.createSampleGroupCtor("stsa", function(stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    });
    BoxParser.createSampleGroupCtor("sync", function(stream) {
      var tmp_byte = stream.readUint8();
      this.NAL_unit_type = tmp_byte & 63;
    });
    BoxParser.createSampleGroupCtor("tele", function(stream) {
      var tmp_byte = stream.readUint8();
      this.level_independently_decodable = tmp_byte >> 7;
    });
    BoxParser.createSampleGroupCtor("tsas", function(stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    });
    BoxParser.createSampleGroupCtor("tscl", function(stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    });
    BoxParser.createSampleGroupCtor("vipr", function(stream) {
      Log.warn("BoxParser", "Sample Group type: " + this.grouping_type + " not fully parsed");
    });
    BoxParser.createFullBoxCtor("sbgp", function(stream) {
      this.grouping_type = stream.readString(4);
      if (this.version === 1) {
        this.grouping_type_parameter = stream.readUint32();
      } else {
        this.grouping_type_parameter = 0;
      }
      this.entries = [];
      var entry_count2 = stream.readUint32();
      for (var i2 = 0; i2 < entry_count2; i2++) {
        var entry = {};
        this.entries.push(entry);
        entry.sample_count = stream.readInt32();
        entry.group_description_index = stream.readInt32();
      }
    });
    function Pixel(row, col) {
      this.bad_pixel_row = row;
      this.bad_pixel_column = col;
    }
    Pixel.prototype.toString = function pixelToString() {
      return "[row: " + this.bad_pixel_row + ", column: " + this.bad_pixel_column + "]";
    };
    BoxParser.createFullBoxCtor("sbpm", function(stream) {
      var i2;
      this.component_count = stream.readUint16();
      this.component_index = [];
      for (i2 = 0; i2 < this.component_count; i2++) {
        this.component_index.push(stream.readUint16());
      }
      var flags = stream.readUint8();
      this.correction_applied = 128 == (flags & 128);
      this.num_bad_rows = stream.readUint32();
      this.num_bad_cols = stream.readUint32();
      this.num_bad_pixels = stream.readUint32();
      this.bad_rows = [];
      this.bad_columns = [];
      this.bad_pixels = [];
      for (i2 = 0; i2 < this.num_bad_rows; i2++) {
        this.bad_rows.push(stream.readUint32());
      }
      for (i2 = 0; i2 < this.num_bad_cols; i2++) {
        this.bad_columns.push(stream.readUint32());
      }
      for (i2 = 0; i2 < this.num_bad_pixels; i2++) {
        var row = stream.readUint32();
        var col = stream.readUint32();
        this.bad_pixels.push(new Pixel(row, col));
      }
    });
    BoxParser.createFullBoxCtor("schm", function(stream) {
      this.scheme_type = stream.readString(4);
      this.scheme_version = stream.readUint32();
      if (this.flags & 1) {
        this.scheme_uri = stream.readString(this.size - this.hdr_size - 8);
      }
    });
    BoxParser.createBoxCtor("sdp ", function(stream) {
      this.sdptext = stream.readString(this.size - this.hdr_size);
    });
    BoxParser.createFullBoxCtor("sdtp", function(stream) {
      var tmp_byte;
      var count = this.size - this.hdr_size;
      this.is_leading = [];
      this.sample_depends_on = [];
      this.sample_is_depended_on = [];
      this.sample_has_redundancy = [];
      for (var i2 = 0; i2 < count; i2++) {
        tmp_byte = stream.readUint8();
        this.is_leading[i2] = tmp_byte >> 6;
        this.sample_depends_on[i2] = tmp_byte >> 4 & 3;
        this.sample_is_depended_on[i2] = tmp_byte >> 2 & 3;
        this.sample_has_redundancy[i2] = tmp_byte & 3;
      }
    });
    BoxParser.createFullBoxCtor(
      "senc"
      /*, function(stream) {
      	this.parseFullHeader(stream);
      	var sample_count = stream.readUint32();
      	this.samples = [];
      	for (var i = 0; i < sample_count; i++) {
      		var sample = {};
      		// tenc.default_Per_Sample_IV_Size or seig.Per_Sample_IV_Size
      		sample.InitializationVector = this.readUint8Array(Per_Sample_IV_Size*8);
      		if (this.flags & 0x2) {
      			sample.subsamples = [];
      			subsample_count = stream.readUint16();
      			for (var j = 0; j < subsample_count; j++) {
      				var subsample = {};
      				subsample.BytesOfClearData = stream.readUint16();
      				subsample.BytesOfProtectedData = stream.readUint32();
      				sample.subsamples.push(subsample);
      			}
      		}
      		// TODO
      		this.samples.push(sample);
      	}
      }*/
    );
    BoxParser.createFullBoxCtor("sgpd", function(stream) {
      this.grouping_type = stream.readString(4);
      Log.debug("BoxParser", "Found Sample Groups of type " + this.grouping_type);
      if (this.version === 1) {
        this.default_length = stream.readUint32();
      } else {
        this.default_length = 0;
      }
      if (this.version >= 2) {
        this.default_group_description_index = stream.readUint32();
      }
      this.entries = [];
      var entry_count2 = stream.readUint32();
      for (var i2 = 0; i2 < entry_count2; i2++) {
        var entry;
        if (BoxParser[this.grouping_type + "SampleGroupEntry"]) {
          entry = new BoxParser[this.grouping_type + "SampleGroupEntry"](this.grouping_type);
        } else {
          entry = new BoxParser.SampleGroupEntry(this.grouping_type);
        }
        this.entries.push(entry);
        if (this.version === 1) {
          if (this.default_length === 0) {
            entry.description_length = stream.readUint32();
          } else {
            entry.description_length = this.default_length;
          }
        } else {
          entry.description_length = this.default_length;
        }
        if (entry.write === BoxParser.SampleGroupEntry.prototype.write) {
          Log.info("BoxParser", "SampleGroup for type " + this.grouping_type + " writing not yet implemented, keeping unparsed data in memory for later write");
          entry.data = stream.readUint8Array(entry.description_length);
          stream.position -= entry.description_length;
        }
        entry.parse(stream);
      }
    });
    BoxParser.createFullBoxCtor("sidx", function(stream) {
      this.reference_ID = stream.readUint32();
      this.timescale = stream.readUint32();
      if (this.version === 0) {
        this.earliest_presentation_time = stream.readUint32();
        this.first_offset = stream.readUint32();
      } else {
        this.earliest_presentation_time = stream.readUint64();
        this.first_offset = stream.readUint64();
      }
      stream.readUint16();
      this.references = [];
      var count = stream.readUint16();
      for (var i2 = 0; i2 < count; i2++) {
        var ref = {};
        this.references.push(ref);
        var tmp_32 = stream.readUint32();
        ref.reference_type = tmp_32 >> 31 & 1;
        ref.referenced_size = tmp_32 & 2147483647;
        ref.subsegment_duration = stream.readUint32();
        tmp_32 = stream.readUint32();
        ref.starts_with_SAP = tmp_32 >> 31 & 1;
        ref.SAP_type = tmp_32 >> 28 & 7;
        ref.SAP_delta_time = tmp_32 & 268435455;
      }
    });
    BoxParser.SingleItemTypeReferenceBox = function(type, size, hdr_size, start) {
      BoxParser.Box.call(this, type, size);
      this.hdr_size = hdr_size;
      this.start = start;
    };
    BoxParser.SingleItemTypeReferenceBox.prototype = new BoxParser.Box();
    BoxParser.SingleItemTypeReferenceBox.prototype.parse = function(stream) {
      this.from_item_ID = stream.readUint16();
      var count = stream.readUint16();
      this.references = [];
      for (var i2 = 0; i2 < count; i2++) {
        this.references[i2] = {};
        this.references[i2].to_item_ID = stream.readUint16();
      }
    };
    BoxParser.SingleItemTypeReferenceBoxLarge = function(type, size, hdr_size, start) {
      BoxParser.Box.call(this, type, size);
      this.hdr_size = hdr_size;
      this.start = start;
    };
    BoxParser.SingleItemTypeReferenceBoxLarge.prototype = new BoxParser.Box();
    BoxParser.SingleItemTypeReferenceBoxLarge.prototype.parse = function(stream) {
      this.from_item_ID = stream.readUint32();
      var count = stream.readUint16();
      this.references = [];
      for (var i2 = 0; i2 < count; i2++) {
        this.references[i2] = {};
        this.references[i2].to_item_ID = stream.readUint32();
      }
    };
    BoxParser.createFullBoxCtor("SmDm", function(stream) {
      this.primaryRChromaticity_x = stream.readUint16();
      this.primaryRChromaticity_y = stream.readUint16();
      this.primaryGChromaticity_x = stream.readUint16();
      this.primaryGChromaticity_y = stream.readUint16();
      this.primaryBChromaticity_x = stream.readUint16();
      this.primaryBChromaticity_y = stream.readUint16();
      this.whitePointChromaticity_x = stream.readUint16();
      this.whitePointChromaticity_y = stream.readUint16();
      this.luminanceMax = stream.readUint32();
      this.luminanceMin = stream.readUint32();
    });
    BoxParser.createFullBoxCtor("smhd", function(stream) {
      this.balance = stream.readUint16();
      stream.readUint16();
    });
    BoxParser.createFullBoxCtor("ssix", function(stream) {
      this.subsegments = [];
      var subsegment_count = stream.readUint32();
      for (var i2 = 0; i2 < subsegment_count; i2++) {
        var subsegment = {};
        this.subsegments.push(subsegment);
        subsegment.ranges = [];
        var range_count = stream.readUint32();
        for (var j2 = 0; j2 < range_count; j2++) {
          var range = {};
          subsegment.ranges.push(range);
          range.level = stream.readUint8();
          range.range_size = stream.readUint24();
        }
      }
    });
    BoxParser.createFullBoxCtor("stco", function(stream) {
      var entry_count2;
      entry_count2 = stream.readUint32();
      this.chunk_offsets = [];
      if (this.version === 0) {
        for (var i2 = 0; i2 < entry_count2; i2++) {
          this.chunk_offsets.push(stream.readUint32());
        }
      }
    });
    BoxParser.createFullBoxCtor("stdp", function(stream) {
      var count = (this.size - this.hdr_size) / 2;
      this.priority = [];
      for (var i2 = 0; i2 < count; i2++) {
        this.priority[i2] = stream.readUint16();
      }
    });
    BoxParser.createFullBoxCtor("sthd");
    BoxParser.createFullBoxCtor("stri", function(stream) {
      this.switch_group = stream.readUint16();
      this.alternate_group = stream.readUint16();
      this.sub_track_id = stream.readUint32();
      var count = (this.size - this.hdr_size - 8) / 4;
      this.attribute_list = [];
      for (var i2 = 0; i2 < count; i2++) {
        this.attribute_list[i2] = stream.readUint32();
      }
    });
    BoxParser.createFullBoxCtor("stsc", function(stream) {
      var entry_count2;
      var i2;
      entry_count2 = stream.readUint32();
      this.first_chunk = [];
      this.samples_per_chunk = [];
      this.sample_description_index = [];
      if (this.version === 0) {
        for (i2 = 0; i2 < entry_count2; i2++) {
          this.first_chunk.push(stream.readUint32());
          this.samples_per_chunk.push(stream.readUint32());
          this.sample_description_index.push(stream.readUint32());
        }
      }
    });
    BoxParser.createFullBoxCtor("stsd", function(stream) {
      var i2;
      var ret2;
      var entryCount;
      var box2;
      this.entries = [];
      entryCount = stream.readUint32();
      for (i2 = 1; i2 <= entryCount; i2++) {
        ret2 = BoxParser.parseOneBox(stream, true, this.size - (stream.getPosition() - this.start));
        if (ret2.code === BoxParser.OK) {
          if (BoxParser[ret2.type + "SampleEntry"]) {
            box2 = new BoxParser[ret2.type + "SampleEntry"](ret2.size);
            box2.hdr_size = ret2.hdr_size;
            box2.start = ret2.start;
          } else {
            Log.warn("BoxParser", "Unknown sample entry type: " + ret2.type);
            box2 = new BoxParser.SampleEntry(ret2.type, ret2.size, ret2.hdr_size, ret2.start);
          }
          if (box2.write === BoxParser.SampleEntry.prototype.write) {
            Log.info("BoxParser", "SampleEntry " + box2.type + " box writing not yet implemented, keeping unparsed data in memory for later write");
            box2.parseDataAndRewind(stream);
          }
          box2.parse(stream);
          this.entries.push(box2);
        } else {
          return;
        }
      }
    });
    BoxParser.createFullBoxCtor("stsg", function(stream) {
      this.grouping_type = stream.readUint32();
      var count = stream.readUint16();
      this.group_description_index = [];
      for (var i2 = 0; i2 < count; i2++) {
        this.group_description_index[i2] = stream.readUint32();
      }
    });
    BoxParser.createFullBoxCtor("stsh", function(stream) {
      var entry_count2;
      var i2;
      entry_count2 = stream.readUint32();
      this.shadowed_sample_numbers = [];
      this.sync_sample_numbers = [];
      if (this.version === 0) {
        for (i2 = 0; i2 < entry_count2; i2++) {
          this.shadowed_sample_numbers.push(stream.readUint32());
          this.sync_sample_numbers.push(stream.readUint32());
        }
      }
    });
    BoxParser.createFullBoxCtor("stss", function(stream) {
      var i2;
      var entry_count2;
      entry_count2 = stream.readUint32();
      if (this.version === 0) {
        this.sample_numbers = [];
        for (i2 = 0; i2 < entry_count2; i2++) {
          this.sample_numbers.push(stream.readUint32());
        }
      }
    });
    BoxParser.createFullBoxCtor("stsz", function(stream) {
      var i2;
      this.sample_sizes = [];
      if (this.version === 0) {
        this.sample_size = stream.readUint32();
        this.sample_count = stream.readUint32();
        for (i2 = 0; i2 < this.sample_count; i2++) {
          if (this.sample_size === 0) {
            this.sample_sizes.push(stream.readUint32());
          } else {
            this.sample_sizes[i2] = this.sample_size;
          }
        }
      }
    });
    BoxParser.createFullBoxCtor("stts", function(stream) {
      var entry_count2;
      var i2;
      var delta;
      entry_count2 = stream.readUint32();
      this.sample_counts = [];
      this.sample_deltas = [];
      if (this.version === 0) {
        for (i2 = 0; i2 < entry_count2; i2++) {
          this.sample_counts.push(stream.readUint32());
          delta = stream.readInt32();
          if (delta < 0) {
            Log.warn("BoxParser", "File uses negative stts sample delta, using value 1 instead, sync may be lost!");
            delta = 1;
          }
          this.sample_deltas.push(delta);
        }
      }
    });
    BoxParser.createFullBoxCtor("stvi", function(stream) {
      var tmp32 = stream.readUint32();
      this.single_view_allowed = tmp32 & 3;
      this.stereo_scheme = stream.readUint32();
      var length = stream.readUint32();
      this.stereo_indication_type = stream.readString(length);
      var ret2;
      var box2;
      this.boxes = [];
      while (stream.getPosition() < this.start + this.size) {
        ret2 = BoxParser.parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
        if (ret2.code === BoxParser.OK) {
          box2 = ret2.box;
          this.boxes.push(box2);
          this[box2.type] = box2;
        } else {
          return;
        }
      }
    });
    BoxParser.createBoxCtor("styp", function(stream) {
      BoxParser.ftypBox.prototype.parse.call(this, stream);
    });
    BoxParser.createFullBoxCtor("stz2", function(stream) {
      var i2;
      var sample_size;
      var sample_count;
      this.sample_sizes = [];
      if (this.version === 0) {
        this.reserved = stream.readUint24();
        this.field_size = stream.readUint8();
        sample_count = stream.readUint32();
        if (this.field_size === 4) {
          for (i2 = 0; i2 < sample_count; i2 += 2) {
            var tmp = stream.readUint8();
            this.sample_sizes[i2] = tmp >> 4 & 15;
            this.sample_sizes[i2 + 1] = tmp & 15;
          }
        } else if (this.field_size === 8) {
          for (i2 = 0; i2 < sample_count; i2++) {
            this.sample_sizes[i2] = stream.readUint8();
          }
        } else if (this.field_size === 16) {
          for (i2 = 0; i2 < sample_count; i2++) {
            this.sample_sizes[i2] = stream.readUint16();
          }
        } else {
          Log.error("BoxParser", "Error in length field in stz2 box");
        }
      }
    });
    BoxParser.createFullBoxCtor("subs", function(stream) {
      var i2, j2;
      var entry_count2;
      var subsample_count;
      entry_count2 = stream.readUint32();
      this.entries = [];
      for (i2 = 0; i2 < entry_count2; i2++) {
        var sampleInfo = {};
        this.entries[i2] = sampleInfo;
        sampleInfo.sample_delta = stream.readUint32();
        sampleInfo.subsamples = [];
        subsample_count = stream.readUint16();
        if (subsample_count > 0) {
          for (j2 = 0; j2 < subsample_count; j2++) {
            var subsample = {};
            sampleInfo.subsamples.push(subsample);
            if (this.version == 1) {
              subsample.size = stream.readUint32();
            } else {
              subsample.size = stream.readUint16();
            }
            subsample.priority = stream.readUint8();
            subsample.discardable = stream.readUint8();
            subsample.codec_specific_parameters = stream.readUint32();
          }
        }
      }
    });
    BoxParser.createFullBoxCtor("tenc", function(stream) {
      stream.readUint8();
      if (this.version === 0) {
        stream.readUint8();
      } else {
        var tmp = stream.readUint8();
        this.default_crypt_byte_block = tmp >> 4 & 15;
        this.default_skip_byte_block = tmp & 15;
      }
      this.default_isProtected = stream.readUint8();
      this.default_Per_Sample_IV_Size = stream.readUint8();
      this.default_KID = BoxParser.parseHex16(stream);
      if (this.default_isProtected === 1 && this.default_Per_Sample_IV_Size === 0) {
        this.default_constant_IV_size = stream.readUint8();
        this.default_constant_IV = stream.readUint8Array(this.default_constant_IV_size);
      }
    });
    BoxParser.createFullBoxCtor("tfdt", function(stream) {
      if (this.version == 1) {
        this.baseMediaDecodeTime = stream.readUint64();
      } else {
        this.baseMediaDecodeTime = stream.readUint32();
      }
    });
    BoxParser.createFullBoxCtor("tfhd", function(stream) {
      var readBytes = 0;
      this.track_id = stream.readUint32();
      if (this.size - this.hdr_size > readBytes && this.flags & BoxParser.TFHD_FLAG_BASE_DATA_OFFSET) {
        this.base_data_offset = stream.readUint64();
        readBytes += 8;
      } else {
        this.base_data_offset = 0;
      }
      if (this.size - this.hdr_size > readBytes && this.flags & BoxParser.TFHD_FLAG_SAMPLE_DESC) {
        this.default_sample_description_index = stream.readUint32();
        readBytes += 4;
      } else {
        this.default_sample_description_index = 0;
      }
      if (this.size - this.hdr_size > readBytes && this.flags & BoxParser.TFHD_FLAG_SAMPLE_DUR) {
        this.default_sample_duration = stream.readUint32();
        readBytes += 4;
      } else {
        this.default_sample_duration = 0;
      }
      if (this.size - this.hdr_size > readBytes && this.flags & BoxParser.TFHD_FLAG_SAMPLE_SIZE) {
        this.default_sample_size = stream.readUint32();
        readBytes += 4;
      } else {
        this.default_sample_size = 0;
      }
      if (this.size - this.hdr_size > readBytes && this.flags & BoxParser.TFHD_FLAG_SAMPLE_FLAGS) {
        this.default_sample_flags = stream.readUint32();
        readBytes += 4;
      } else {
        this.default_sample_flags = 0;
      }
    });
    BoxParser.createFullBoxCtor("tfra", function(stream) {
      this.track_ID = stream.readUint32();
      stream.readUint24();
      var tmp_byte = stream.readUint8();
      this.length_size_of_traf_num = tmp_byte >> 4 & 3;
      this.length_size_of_trun_num = tmp_byte >> 2 & 3;
      this.length_size_of_sample_num = tmp_byte & 3;
      this.entries = [];
      var number_of_entries = stream.readUint32();
      for (var i2 = 0; i2 < number_of_entries; i2++) {
        if (this.version === 1) {
          this.time = stream.readUint64();
          this.moof_offset = stream.readUint64();
        } else {
          this.time = stream.readUint32();
          this.moof_offset = stream.readUint32();
        }
        this.traf_number = stream["readUint" + 8 * (this.length_size_of_traf_num + 1)]();
        this.trun_number = stream["readUint" + 8 * (this.length_size_of_trun_num + 1)]();
        this.sample_number = stream["readUint" + 8 * (this.length_size_of_sample_num + 1)]();
      }
    });
    BoxParser.createFullBoxCtor("tkhd", function(stream) {
      if (this.version == 1) {
        this.creation_time = stream.readUint64();
        this.modification_time = stream.readUint64();
        this.track_id = stream.readUint32();
        stream.readUint32();
        this.duration = stream.readUint64();
      } else {
        this.creation_time = stream.readUint32();
        this.modification_time = stream.readUint32();
        this.track_id = stream.readUint32();
        stream.readUint32();
        this.duration = stream.readUint32();
      }
      stream.readUint32Array(2);
      this.layer = stream.readInt16();
      this.alternate_group = stream.readInt16();
      this.volume = stream.readInt16() >> 8;
      stream.readUint16();
      this.matrix = stream.readInt32Array(9);
      this.width = stream.readUint32();
      this.height = stream.readUint32();
    });
    BoxParser.createBoxCtor("tmax", function(stream) {
      this.time = stream.readUint32();
    });
    BoxParser.createBoxCtor("tmin", function(stream) {
      this.time = stream.readUint32();
    });
    BoxParser.createBoxCtor("totl", function(stream) {
      this.bytessent = stream.readUint32();
    });
    BoxParser.createBoxCtor("tpay", function(stream) {
      this.bytessent = stream.readUint32();
    });
    BoxParser.createBoxCtor("tpyl", function(stream) {
      this.bytessent = stream.readUint64();
    });
    BoxParser.TrackGroupTypeBox.prototype.parse = function(stream) {
      this.parseFullHeader(stream);
      this.track_group_id = stream.readUint32();
    };
    BoxParser.createTrackGroupCtor("msrc");
    BoxParser.TrackReferenceTypeBox = function(type, size, hdr_size, start) {
      BoxParser.Box.call(this, type, size);
      this.hdr_size = hdr_size;
      this.start = start;
    };
    BoxParser.TrackReferenceTypeBox.prototype = new BoxParser.Box();
    BoxParser.TrackReferenceTypeBox.prototype.parse = function(stream) {
      this.track_ids = stream.readUint32Array((this.size - this.hdr_size) / 4);
    };
    BoxParser.trefBox.prototype.parse = function(stream) {
      var ret2;
      var box2;
      while (stream.getPosition() < this.start + this.size) {
        ret2 = BoxParser.parseOneBox(stream, true, this.size - (stream.getPosition() - this.start));
        if (ret2.code === BoxParser.OK) {
          box2 = new BoxParser.TrackReferenceTypeBox(ret2.type, ret2.size, ret2.hdr_size, ret2.start);
          if (box2.write === BoxParser.Box.prototype.write && box2.type !== "mdat") {
            Log.info("BoxParser", "TrackReference " + box2.type + " box writing not yet implemented, keeping unparsed data in memory for later write");
            box2.parseDataAndRewind(stream);
          }
          box2.parse(stream);
          this.boxes.push(box2);
        } else {
          return;
        }
      }
    };
    BoxParser.createFullBoxCtor("trep", function(stream) {
      this.track_ID = stream.readUint32();
      this.boxes = [];
      while (stream.getPosition() < this.start + this.size) {
        ret = BoxParser.parseOneBox(stream, false, this.size - (stream.getPosition() - this.start));
        if (ret.code === BoxParser.OK) {
          box = ret.box;
          this.boxes.push(box);
        } else {
          return;
        }
      }
    });
    BoxParser.createFullBoxCtor("trex", function(stream) {
      this.track_id = stream.readUint32();
      this.default_sample_description_index = stream.readUint32();
      this.default_sample_duration = stream.readUint32();
      this.default_sample_size = stream.readUint32();
      this.default_sample_flags = stream.readUint32();
    });
    BoxParser.createBoxCtor("trpy", function(stream) {
      this.bytessent = stream.readUint64();
    });
    BoxParser.createFullBoxCtor("trun", function(stream) {
      var readBytes = 0;
      this.sample_count = stream.readUint32();
      readBytes += 4;
      if (this.size - this.hdr_size > readBytes && this.flags & BoxParser.TRUN_FLAGS_DATA_OFFSET) {
        this.data_offset = stream.readInt32();
        readBytes += 4;
      } else {
        this.data_offset = 0;
      }
      if (this.size - this.hdr_size > readBytes && this.flags & BoxParser.TRUN_FLAGS_FIRST_FLAG) {
        this.first_sample_flags = stream.readUint32();
        readBytes += 4;
      } else {
        this.first_sample_flags = 0;
      }
      this.sample_duration = [];
      this.sample_size = [];
      this.sample_flags = [];
      this.sample_composition_time_offset = [];
      if (this.size - this.hdr_size > readBytes) {
        for (var i2 = 0; i2 < this.sample_count; i2++) {
          if (this.flags & BoxParser.TRUN_FLAGS_DURATION) {
            this.sample_duration[i2] = stream.readUint32();
          }
          if (this.flags & BoxParser.TRUN_FLAGS_SIZE) {
            this.sample_size[i2] = stream.readUint32();
          }
          if (this.flags & BoxParser.TRUN_FLAGS_FLAGS) {
            this.sample_flags[i2] = stream.readUint32();
          }
          if (this.flags & BoxParser.TRUN_FLAGS_CTS_OFFSET) {
            if (this.version === 0) {
              this.sample_composition_time_offset[i2] = stream.readUint32();
            } else {
              this.sample_composition_time_offset[i2] = stream.readInt32();
            }
          }
        }
      }
    });
    BoxParser.createFullBoxCtor("tsel", function(stream) {
      this.switch_group = stream.readUint32();
      var count = (this.size - this.hdr_size - 4) / 4;
      this.attribute_list = [];
      for (var i2 = 0; i2 < count; i2++) {
        this.attribute_list[i2] = stream.readUint32();
      }
    });
    BoxParser.createFullBoxCtor("txtC", function(stream) {
      this.config = stream.readCString();
    });
    BoxParser.createBoxCtor("tyco", function(stream) {
      var count = (this.size - this.hdr_size) / 4;
      this.compatible_brands = [];
      for (var i2 = 0; i2 < count; i2++) {
        this.compatible_brands[i2] = stream.readString(4);
      }
    });
    BoxParser.createFullBoxCtor("udes", function(stream) {
      this.lang = stream.readCString();
      this.name = stream.readCString();
      this.description = stream.readCString();
      this.tags = stream.readCString();
    });
    BoxParser.createFullBoxCtor("uncC", function(stream) {
      var i2;
      this.profile = stream.readUint32();
      if (this.version == 1) {
      } else if (this.version == 0) {
        this.component_count = stream.readUint32();
        this.component_index = [];
        this.component_bit_depth_minus_one = [];
        this.component_format = [];
        this.component_align_size = [];
        for (i2 = 0; i2 < this.component_count; i2++) {
          this.component_index.push(stream.readUint16());
          this.component_bit_depth_minus_one.push(stream.readUint8());
          this.component_format.push(stream.readUint8());
          this.component_align_size.push(stream.readUint8());
        }
        this.sampling_type = stream.readUint8();
        this.interleave_type = stream.readUint8();
        this.block_size = stream.readUint8();
        var flags = stream.readUint8();
        this.component_little_endian = flags >> 7 & 1;
        this.block_pad_lsb = flags >> 6 & 1;
        this.block_little_endian = flags >> 5 & 1;
        this.block_reversed = flags >> 4 & 1;
        this.pad_unknown = flags >> 3 & 1;
        this.pixel_size = stream.readUint32();
        this.row_align_size = stream.readUint32();
        this.tile_align_size = stream.readUint32();
        this.num_tile_cols_minus_one = stream.readUint32();
        this.num_tile_rows_minus_one = stream.readUint32();
      }
    });
    BoxParser.createFullBoxCtor("url ", function(stream) {
      if (this.flags !== 1) {
        this.location = stream.readCString();
      }
    });
    BoxParser.createFullBoxCtor("urn ", function(stream) {
      this.name = stream.readCString();
      if (this.size - this.hdr_size - this.name.length - 1 > 0) {
        this.location = stream.readCString();
      }
    });
    BoxParser.createUUIDBox("a5d40b30e81411ddba2f0800200c9a66", true, false, function(stream) {
      this.LiveServerManifest = stream.readString(this.size - this.hdr_size).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    });
    BoxParser.createUUIDBox("d08a4f1810f34a82b6c832d8aba183d3", true, false, function(stream) {
      this.system_id = BoxParser.parseHex16(stream);
      var datasize = stream.readUint32();
      if (datasize > 0) {
        this.data = stream.readUint8Array(datasize);
      }
    });
    BoxParser.createUUIDBox(
      "a2394f525a9b4f14a2446c427c648df4",
      true,
      false
      /*, function(stream) {
      	if (this.flags & 0x1) {
      		this.AlgorithmID = stream.readUint24();
      		this.IV_size = stream.readUint8();
      		this.KID = BoxParser.parseHex16(stream);
      	}
      	var sample_count = stream.readUint32();
      	this.samples = [];
      	for (var i = 0; i < sample_count; i++) {
      		var sample = {};
      		sample.InitializationVector = this.readUint8Array(this.IV_size*8);
      		if (this.flags & 0x2) {
      			sample.subsamples = [];
      			sample.NumberOfEntries = stream.readUint16();
      			for (var j = 0; j < sample.NumberOfEntries; j++) {
      				var subsample = {};
      				subsample.BytesOfClearData = stream.readUint16();
      				subsample.BytesOfProtectedData = stream.readUint32();
      				sample.subsamples.push(subsample);
      			}
      		}
      		this.samples.push(sample);
      	}
      }*/
    );
    BoxParser.createUUIDBox("8974dbce7be74c5184f97148f9882554", true, false, function(stream) {
      this.default_AlgorithmID = stream.readUint24();
      this.default_IV_size = stream.readUint8();
      this.default_KID = BoxParser.parseHex16(stream);
    });
    BoxParser.createUUIDBox("d4807ef2ca3946958e5426cb9e46a79f", true, false, function(stream) {
      this.fragment_count = stream.readUint8();
      this.entries = [];
      for (var i2 = 0; i2 < this.fragment_count; i2++) {
        var entry = {};
        var absolute_time = 0;
        var absolute_duration = 0;
        if (this.version === 1) {
          absolute_time = stream.readUint64();
          absolute_duration = stream.readUint64();
        } else {
          absolute_time = stream.readUint32();
          absolute_duration = stream.readUint32();
        }
        entry.absolute_time = absolute_time;
        entry.absolute_duration = absolute_duration;
        this.entries.push(entry);
      }
    });
    BoxParser.createUUIDBox("6d1d9b0542d544e680e2141daff757b2", true, false, function(stream) {
      if (this.version === 1) {
        this.absolute_time = stream.readUint64();
        this.duration = stream.readUint64();
      } else {
        this.absolute_time = stream.readUint32();
        this.duration = stream.readUint32();
      }
    });
    BoxParser.createFullBoxCtor("vmhd", function(stream) {
      this.graphicsmode = stream.readUint16();
      this.opcolor = stream.readUint16Array(3);
    });
    BoxParser.createFullBoxCtor("vpcC", function(stream) {
      var tmp;
      if (this.version === 1) {
        this.profile = stream.readUint8();
        this.level = stream.readUint8();
        tmp = stream.readUint8();
        this.bitDepth = tmp >> 4;
        this.chromaSubsampling = tmp >> 1 & 7;
        this.videoFullRangeFlag = tmp & 1;
        this.colourPrimaries = stream.readUint8();
        this.transferCharacteristics = stream.readUint8();
        this.matrixCoefficients = stream.readUint8();
        this.codecIntializationDataSize = stream.readUint16();
        this.codecIntializationData = stream.readUint8Array(this.codecIntializationDataSize);
      } else {
        this.profile = stream.readUint8();
        this.level = stream.readUint8();
        tmp = stream.readUint8();
        this.bitDepth = tmp >> 4 & 15;
        this.colorSpace = tmp & 15;
        tmp = stream.readUint8();
        this.chromaSubsampling = tmp >> 4 & 15;
        this.transferFunction = tmp >> 1 & 7;
        this.videoFullRangeFlag = tmp & 1;
        this.codecIntializationDataSize = stream.readUint16();
        this.codecIntializationData = stream.readUint8Array(this.codecIntializationDataSize);
      }
    });
    BoxParser.createBoxCtor("vttC", function(stream) {
      this.text = stream.readString(this.size - this.hdr_size);
    });
    BoxParser.createFullBoxCtor("vvcC", function(stream) {
      var i2, j2;
      var bitReader = {
        held_bits: void 0,
        num_held_bits: 0,
        stream_read_1_bytes: function(strm2) {
          this.held_bits = strm2.readUint8();
          this.num_held_bits = 1 * 8;
        },
        stream_read_2_bytes: function(strm2) {
          this.held_bits = strm2.readUint16();
          this.num_held_bits = 2 * 8;
        },
        extract_bits: function(num_bits) {
          var ret2 = this.held_bits >> this.num_held_bits - num_bits & (1 << num_bits) - 1;
          this.num_held_bits -= num_bits;
          return ret2;
        }
      };
      bitReader.stream_read_1_bytes(stream);
      bitReader.extract_bits(5);
      this.lengthSizeMinusOne = bitReader.extract_bits(2);
      this.ptl_present_flag = bitReader.extract_bits(1);
      if (this.ptl_present_flag) {
        bitReader.stream_read_2_bytes(stream);
        this.ols_idx = bitReader.extract_bits(9);
        this.num_sublayers = bitReader.extract_bits(3);
        this.constant_frame_rate = bitReader.extract_bits(2);
        this.chroma_format_idc = bitReader.extract_bits(2);
        bitReader.stream_read_1_bytes(stream);
        this.bit_depth_minus8 = bitReader.extract_bits(3);
        bitReader.extract_bits(5);
        {
          bitReader.stream_read_2_bytes(stream);
          bitReader.extract_bits(2);
          this.num_bytes_constraint_info = bitReader.extract_bits(6);
          this.general_profile_idc = bitReader.extract_bits(7);
          this.general_tier_flag = bitReader.extract_bits(1);
          this.general_level_idc = stream.readUint8();
          bitReader.stream_read_1_bytes(stream);
          this.ptl_frame_only_constraint_flag = bitReader.extract_bits(1);
          this.ptl_multilayer_enabled_flag = bitReader.extract_bits(1);
          this.general_constraint_info = new Uint8Array(this.num_bytes_constraint_info);
          if (this.num_bytes_constraint_info) {
            for (i2 = 0; i2 < this.num_bytes_constraint_info - 1; i2++) {
              var cnstr1 = bitReader.extract_bits(6);
              bitReader.stream_read_1_bytes(stream);
              var cnstr2 = bitReader.extract_bits(2);
              this.general_constraint_info[i2] = cnstr1 << 2 | cnstr2;
            }
            this.general_constraint_info[this.num_bytes_constraint_info - 1] = bitReader.extract_bits(6);
          } else {
            bitReader.extract_bits(6);
          }
          if (this.num_sublayers > 1) {
            bitReader.stream_read_1_bytes(stream);
            this.ptl_sublayer_present_mask = 0;
            for (j2 = this.num_sublayers - 2; j2 >= 0; --j2) {
              var val = bitReader.extract_bits(1);
              this.ptl_sublayer_present_mask |= val << j2;
            }
            for (j2 = this.num_sublayers; j2 <= 8 && this.num_sublayers > 1; ++j2) {
              bitReader.extract_bits(1);
            }
            this.sublayer_level_idc = [];
            for (j2 = this.num_sublayers - 2; j2 >= 0; --j2) {
              if (this.ptl_sublayer_present_mask & 1 << j2) {
                this.sublayer_level_idc[j2] = stream.readUint8();
              }
            }
          }
          this.ptl_num_sub_profiles = stream.readUint8();
          this.general_sub_profile_idc = [];
          if (this.ptl_num_sub_profiles) {
            for (i2 = 0; i2 < this.ptl_num_sub_profiles; i2++) {
              this.general_sub_profile_idc.push(stream.readUint32());
            }
          }
        }
        this.max_picture_width = stream.readUint16();
        this.max_picture_height = stream.readUint16();
        this.avg_frame_rate = stream.readUint16();
      }
      var VVC_NALU_OPI = 12;
      var VVC_NALU_DEC_PARAM = 13;
      this.nalu_arrays = [];
      var num_of_arrays = stream.readUint8();
      for (i2 = 0; i2 < num_of_arrays; i2++) {
        var nalu_array = [];
        this.nalu_arrays.push(nalu_array);
        bitReader.stream_read_1_bytes(stream);
        nalu_array.completeness = bitReader.extract_bits(1);
        bitReader.extract_bits(2);
        nalu_array.nalu_type = bitReader.extract_bits(5);
        var numNalus = 1;
        if (nalu_array.nalu_type != VVC_NALU_DEC_PARAM && nalu_array.nalu_type != VVC_NALU_OPI) {
          numNalus = stream.readUint16();
        }
        for (j2 = 0; j2 < numNalus; j2++) {
          var len = stream.readUint16();
          nalu_array.push({
            data: stream.readUint8Array(len),
            length: len
          });
        }
      }
    });
    BoxParser.createFullBoxCtor("vvnC", function(stream) {
      var tmp = strm.readUint8();
      this.lengthSizeMinusOne = tmp & 3;
    });
    BoxParser.SampleEntry.prototype.isVideo = function() {
      return false;
    };
    BoxParser.SampleEntry.prototype.isAudio = function() {
      return false;
    };
    BoxParser.SampleEntry.prototype.isSubtitle = function() {
      return false;
    };
    BoxParser.SampleEntry.prototype.isMetadata = function() {
      return false;
    };
    BoxParser.SampleEntry.prototype.isHint = function() {
      return false;
    };
    BoxParser.SampleEntry.prototype.getCodec = function() {
      return this.type.replace(".", "");
    };
    BoxParser.SampleEntry.prototype.getWidth = function() {
      return "";
    };
    BoxParser.SampleEntry.prototype.getHeight = function() {
      return "";
    };
    BoxParser.SampleEntry.prototype.getChannelCount = function() {
      return "";
    };
    BoxParser.SampleEntry.prototype.getSampleRate = function() {
      return "";
    };
    BoxParser.SampleEntry.prototype.getSampleSize = function() {
      return "";
    };
    BoxParser.VisualSampleEntry.prototype.isVideo = function() {
      return true;
    };
    BoxParser.VisualSampleEntry.prototype.getWidth = function() {
      return this.width;
    };
    BoxParser.VisualSampleEntry.prototype.getHeight = function() {
      return this.height;
    };
    BoxParser.AudioSampleEntry.prototype.isAudio = function() {
      return true;
    };
    BoxParser.AudioSampleEntry.prototype.getChannelCount = function() {
      return this.channel_count;
    };
    BoxParser.AudioSampleEntry.prototype.getSampleRate = function() {
      return this.samplerate;
    };
    BoxParser.AudioSampleEntry.prototype.getSampleSize = function() {
      return this.samplesize;
    };
    BoxParser.SubtitleSampleEntry.prototype.isSubtitle = function() {
      return true;
    };
    BoxParser.MetadataSampleEntry.prototype.isMetadata = function() {
      return true;
    };
    BoxParser.decimalToHex = function(d2, padding) {
      var hex = Number(d2).toString(16);
      padding = typeof padding === "undefined" || padding === null ? padding = 2 : padding;
      while (hex.length < padding) {
        hex = "0" + hex;
      }
      return hex;
    };
    BoxParser.avc1SampleEntry.prototype.getCodec = BoxParser.avc2SampleEntry.prototype.getCodec = BoxParser.avc3SampleEntry.prototype.getCodec = BoxParser.avc4SampleEntry.prototype.getCodec = function() {
      var baseCodec = BoxParser.SampleEntry.prototype.getCodec.call(this);
      if (this.avcC) {
        return baseCodec + "." + BoxParser.decimalToHex(this.avcC.AVCProfileIndication) + BoxParser.decimalToHex(this.avcC.profile_compatibility) + BoxParser.decimalToHex(this.avcC.AVCLevelIndication);
      } else {
        return baseCodec;
      }
    };
    BoxParser.hev1SampleEntry.prototype.getCodec = BoxParser.hvc1SampleEntry.prototype.getCodec = function() {
      var i2;
      var baseCodec = BoxParser.SampleEntry.prototype.getCodec.call(this);
      if (this.hvcC) {
        baseCodec += ".";
        switch (this.hvcC.general_profile_space) {
          case 0:
            baseCodec += "";
            break;
          case 1:
            baseCodec += "A";
            break;
          case 2:
            baseCodec += "B";
            break;
          case 3:
            baseCodec += "C";
            break;
        }
        baseCodec += this.hvcC.general_profile_idc;
        baseCodec += ".";
        var val = this.hvcC.general_profile_compatibility;
        var reversed = 0;
        for (i2 = 0; i2 < 32; i2++) {
          reversed |= val & 1;
          if (i2 == 31) break;
          reversed <<= 1;
          val >>= 1;
        }
        baseCodec += BoxParser.decimalToHex(reversed, 0);
        baseCodec += ".";
        if (this.hvcC.general_tier_flag === 0) {
          baseCodec += "L";
        } else {
          baseCodec += "H";
        }
        baseCodec += this.hvcC.general_level_idc;
        var hasByte = false;
        var constraint_string = "";
        for (i2 = 5; i2 >= 0; i2--) {
          if (this.hvcC.general_constraint_indicator[i2] || hasByte) {
            constraint_string = "." + BoxParser.decimalToHex(this.hvcC.general_constraint_indicator[i2], 0) + constraint_string;
            hasByte = true;
          }
        }
        baseCodec += constraint_string;
      }
      return baseCodec;
    };
    BoxParser.vvc1SampleEntry.prototype.getCodec = BoxParser.vvi1SampleEntry.prototype.getCodec = function() {
      var i2;
      var baseCodec = BoxParser.SampleEntry.prototype.getCodec.call(this);
      if (this.vvcC) {
        baseCodec += "." + this.vvcC.general_profile_idc;
        if (this.vvcC.general_tier_flag) {
          baseCodec += ".H";
        } else {
          baseCodec += ".L";
        }
        baseCodec += this.vvcC.general_level_idc;
        var constraint_string = "";
        if (this.vvcC.general_constraint_info) {
          var bytes = [];
          var byte = 0;
          byte |= this.vvcC.ptl_frame_only_constraint << 7;
          byte |= this.vvcC.ptl_multilayer_enabled << 6;
          var last_nonzero;
          for (i2 = 0; i2 < this.vvcC.general_constraint_info.length; ++i2) {
            byte |= this.vvcC.general_constraint_info[i2] >> 2 & 63;
            bytes.push(byte);
            if (byte) {
              last_nonzero = i2;
            }
            byte = this.vvcC.general_constraint_info[i2] >> 2 & 3;
          }
          if (last_nonzero === void 0) {
            constraint_string = ".CA";
          } else {
            constraint_string = ".C";
            var base32_chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
            var held_bits = 0;
            var num_held_bits = 0;
            for (i2 = 0; i2 <= last_nonzero; ++i2) {
              held_bits = held_bits << 8 | bytes[i2];
              num_held_bits += 8;
              while (num_held_bits >= 5) {
                var val = held_bits >> num_held_bits - 5 & 31;
                constraint_string += base32_chars[val];
                num_held_bits -= 5;
                held_bits &= (1 << num_held_bits) - 1;
              }
            }
            if (num_held_bits) {
              held_bits <<= 5 - num_held_bits;
              constraint_string += base32_chars[held_bits & 31];
            }
          }
        }
        baseCodec += constraint_string;
      }
      return baseCodec;
    };
    BoxParser.mp4aSampleEntry.prototype.getCodec = function() {
      var baseCodec = BoxParser.SampleEntry.prototype.getCodec.call(this);
      if (this.esds && this.esds.esd) {
        var oti = this.esds.esd.getOTI();
        var dsi = this.esds.esd.getAudioConfig();
        return baseCodec + "." + BoxParser.decimalToHex(oti) + (dsi ? "." + dsi : "");
      } else {
        return baseCodec;
      }
    };
    BoxParser.stxtSampleEntry.prototype.getCodec = function() {
      var baseCodec = BoxParser.SampleEntry.prototype.getCodec.call(this);
      if (this.mime_format) {
        return baseCodec + "." + this.mime_format;
      } else {
        return baseCodec;
      }
    };
    BoxParser.vp08SampleEntry.prototype.getCodec = BoxParser.vp09SampleEntry.prototype.getCodec = function() {
      var baseCodec = BoxParser.SampleEntry.prototype.getCodec.call(this);
      var level = this.vpcC.level;
      if (level == 0) {
        level = "00";
      }
      var bitDepth = this.vpcC.bitDepth;
      if (bitDepth == 8) {
        bitDepth = "08";
      }
      return baseCodec + ".0" + this.vpcC.profile + "." + level + "." + bitDepth;
    };
    BoxParser.av01SampleEntry.prototype.getCodec = function() {
      var baseCodec = BoxParser.SampleEntry.prototype.getCodec.call(this);
      var level = this.av1C.seq_level_idx_0;
      if (level < 10) {
        level = "0" + level;
      }
      var bitdepth;
      if (this.av1C.seq_profile === 2 && this.av1C.high_bitdepth === 1) {
        bitdepth = this.av1C.twelve_bit === 1 ? "12" : "10";
      } else if (this.av1C.seq_profile <= 2) {
        bitdepth = this.av1C.high_bitdepth === 1 ? "10" : "08";
      }
      return baseCodec + "." + this.av1C.seq_profile + "." + level + (this.av1C.seq_tier_0 ? "H" : "M") + "." + bitdepth;
    };
    BoxParser.Box.prototype.writeHeader = function(stream, msg) {
      this.size += 8;
      if (this.size > MAX_SIZE) {
        this.size += 8;
      }
      if (this.type === "uuid") {
        this.size += 16;
      }
      Log.debug("BoxWriter", "Writing box " + this.type + " of size: " + this.size + " at position " + stream.getPosition() + (msg || ""));
      if (this.size > MAX_SIZE) {
        stream.writeUint32(1);
      } else {
        this.sizePosition = stream.getPosition();
        stream.writeUint32(this.size);
      }
      stream.writeString(this.type, null, 4);
      if (this.type === "uuid") {
        stream.writeUint8Array(this.uuid);
      }
      if (this.size > MAX_SIZE) {
        stream.writeUint64(this.size);
      }
    };
    BoxParser.FullBox.prototype.writeHeader = function(stream) {
      this.size += 4;
      BoxParser.Box.prototype.writeHeader.call(this, stream, " v=" + this.version + " f=" + this.flags);
      stream.writeUint8(this.version);
      stream.writeUint24(this.flags);
    };
    BoxParser.Box.prototype.write = function(stream) {
      if (this.type === "mdat") {
        if (this.data) {
          this.size = this.data.length;
          this.writeHeader(stream);
          stream.writeUint8Array(this.data);
        }
      } else {
        this.size = this.data ? this.data.length : 0;
        this.writeHeader(stream);
        if (this.data) {
          stream.writeUint8Array(this.data);
        }
      }
    };
    BoxParser.ContainerBox.prototype.write = function(stream) {
      this.size = 0;
      this.writeHeader(stream);
      for (var i2 = 0; i2 < this.boxes.length; i2++) {
        if (this.boxes[i2]) {
          this.boxes[i2].write(stream);
          this.size += this.boxes[i2].size;
        }
      }
      Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
      stream.adjustUint32(this.sizePosition, this.size);
    };
    BoxParser.TrackReferenceTypeBox.prototype.write = function(stream) {
      this.size = this.track_ids.length * 4;
      this.writeHeader(stream);
      stream.writeUint32Array(this.track_ids);
    };
    BoxParser.avcCBox.prototype.write = function(stream) {
      var i2;
      this.size = 7;
      for (i2 = 0; i2 < this.SPS.length; i2++) {
        this.size += 2 + this.SPS[i2].length;
      }
      for (i2 = 0; i2 < this.PPS.length; i2++) {
        this.size += 2 + this.PPS[i2].length;
      }
      if (this.ext) {
        this.size += this.ext.length;
      }
      this.writeHeader(stream);
      stream.writeUint8(this.configurationVersion);
      stream.writeUint8(this.AVCProfileIndication);
      stream.writeUint8(this.profile_compatibility);
      stream.writeUint8(this.AVCLevelIndication);
      stream.writeUint8(this.lengthSizeMinusOne + (63 << 2));
      stream.writeUint8(this.SPS.length + (7 << 5));
      for (i2 = 0; i2 < this.SPS.length; i2++) {
        stream.writeUint16(this.SPS[i2].length);
        stream.writeUint8Array(this.SPS[i2].nalu);
      }
      stream.writeUint8(this.PPS.length);
      for (i2 = 0; i2 < this.PPS.length; i2++) {
        stream.writeUint16(this.PPS[i2].length);
        stream.writeUint8Array(this.PPS[i2].nalu);
      }
      if (this.ext) {
        stream.writeUint8Array(this.ext);
      }
    };
    BoxParser.co64Box.prototype.write = function(stream) {
      var i2;
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 8 * this.chunk_offsets.length;
      this.writeHeader(stream);
      stream.writeUint32(this.chunk_offsets.length);
      for (i2 = 0; i2 < this.chunk_offsets.length; i2++) {
        stream.writeUint64(this.chunk_offsets[i2]);
      }
    };
    BoxParser.cslgBox.prototype.write = function(stream) {
      var i2;
      this.version = 0;
      this.flags = 0;
      this.size = 4 * 5;
      this.writeHeader(stream);
      stream.writeInt32(this.compositionToDTSShift);
      stream.writeInt32(this.leastDecodeToDisplayDelta);
      stream.writeInt32(this.greatestDecodeToDisplayDelta);
      stream.writeInt32(this.compositionStartTime);
      stream.writeInt32(this.compositionEndTime);
    };
    BoxParser.cttsBox.prototype.write = function(stream) {
      var i2;
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 8 * this.sample_counts.length;
      this.writeHeader(stream);
      stream.writeUint32(this.sample_counts.length);
      for (i2 = 0; i2 < this.sample_counts.length; i2++) {
        stream.writeUint32(this.sample_counts[i2]);
        if (this.version === 1) {
          stream.writeInt32(this.sample_offsets[i2]);
        } else {
          stream.writeUint32(this.sample_offsets[i2]);
        }
      }
    };
    BoxParser.drefBox.prototype.write = function(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4;
      this.writeHeader(stream);
      stream.writeUint32(this.entries.length);
      for (var i2 = 0; i2 < this.entries.length; i2++) {
        this.entries[i2].write(stream);
        this.size += this.entries[i2].size;
      }
      Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
      stream.adjustUint32(this.sizePosition, this.size);
    };
    BoxParser.elngBox.prototype.write = function(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = this.extended_language.length;
      this.writeHeader(stream);
      stream.writeString(this.extended_language);
    };
    BoxParser.elstBox.prototype.write = function(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 12 * this.entries.length;
      this.writeHeader(stream);
      stream.writeUint32(this.entries.length);
      for (var i2 = 0; i2 < this.entries.length; i2++) {
        var entry = this.entries[i2];
        stream.writeUint32(entry.segment_duration);
        stream.writeInt32(entry.media_time);
        stream.writeInt16(entry.media_rate_integer);
        stream.writeInt16(entry.media_rate_fraction);
      }
    };
    BoxParser.emsgBox.prototype.write = function(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4 * 4 + this.message_data.length + (this.scheme_id_uri.length + 1) + (this.value.length + 1);
      this.writeHeader(stream);
      stream.writeCString(this.scheme_id_uri);
      stream.writeCString(this.value);
      stream.writeUint32(this.timescale);
      stream.writeUint32(this.presentation_time_delta);
      stream.writeUint32(this.event_duration);
      stream.writeUint32(this.id);
      stream.writeUint8Array(this.message_data);
    };
    BoxParser.ftypBox.prototype.write = function(stream) {
      this.size = 8 + 4 * this.compatible_brands.length;
      this.writeHeader(stream);
      stream.writeString(this.major_brand, null, 4);
      stream.writeUint32(this.minor_version);
      for (var i2 = 0; i2 < this.compatible_brands.length; i2++) {
        stream.writeString(this.compatible_brands[i2], null, 4);
      }
    };
    BoxParser.hdlrBox.prototype.write = function(stream) {
      this.size = 5 * 4 + this.name.length + 1;
      this.version = 0;
      this.flags = 0;
      this.writeHeader(stream);
      stream.writeUint32(0);
      stream.writeString(this.handler, null, 4);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeCString(this.name);
    };
    BoxParser.hvcCBox.prototype.write = function(stream) {
      var i2, j2;
      this.size = 23;
      for (i2 = 0; i2 < this.nalu_arrays.length; i2++) {
        this.size += 3;
        for (j2 = 0; j2 < this.nalu_arrays[i2].length; j2++) {
          this.size += 2 + this.nalu_arrays[i2][j2].data.length;
        }
      }
      this.writeHeader(stream);
      stream.writeUint8(this.configurationVersion);
      stream.writeUint8((this.general_profile_space << 6) + (this.general_tier_flag << 5) + this.general_profile_idc);
      stream.writeUint32(this.general_profile_compatibility);
      stream.writeUint8Array(this.general_constraint_indicator);
      stream.writeUint8(this.general_level_idc);
      stream.writeUint16(this.min_spatial_segmentation_idc + (15 << 24));
      stream.writeUint8(this.parallelismType + (63 << 2));
      stream.writeUint8(this.chroma_format_idc + (63 << 2));
      stream.writeUint8(this.bit_depth_luma_minus8 + (31 << 3));
      stream.writeUint8(this.bit_depth_chroma_minus8 + (31 << 3));
      stream.writeUint16(this.avgFrameRate);
      stream.writeUint8((this.constantFrameRate << 6) + (this.numTemporalLayers << 3) + (this.temporalIdNested << 2) + this.lengthSizeMinusOne);
      stream.writeUint8(this.nalu_arrays.length);
      for (i2 = 0; i2 < this.nalu_arrays.length; i2++) {
        stream.writeUint8((this.nalu_arrays[i2].completeness << 7) + this.nalu_arrays[i2].nalu_type);
        stream.writeUint16(this.nalu_arrays[i2].length);
        for (j2 = 0; j2 < this.nalu_arrays[i2].length; j2++) {
          stream.writeUint16(this.nalu_arrays[i2][j2].data.length);
          stream.writeUint8Array(this.nalu_arrays[i2][j2].data);
        }
      }
    };
    BoxParser.kindBox.prototype.write = function(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = this.schemeURI.length + 1 + (this.value.length + 1);
      this.writeHeader(stream);
      stream.writeCString(this.schemeURI);
      stream.writeCString(this.value);
    };
    BoxParser.mdhdBox.prototype.write = function(stream) {
      this.size = 4 * 4 + 2 * 2;
      this.flags = 0;
      this.version = 0;
      this.writeHeader(stream);
      stream.writeUint32(this.creation_time);
      stream.writeUint32(this.modification_time);
      stream.writeUint32(this.timescale);
      stream.writeUint32(this.duration);
      stream.writeUint16(this.language);
      stream.writeUint16(0);
    };
    BoxParser.mehdBox.prototype.write = function(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4;
      this.writeHeader(stream);
      stream.writeUint32(this.fragment_duration);
    };
    BoxParser.mfhdBox.prototype.write = function(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4;
      this.writeHeader(stream);
      stream.writeUint32(this.sequence_number);
    };
    BoxParser.mvhdBox.prototype.write = function(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 23 * 4 + 2 * 2;
      this.writeHeader(stream);
      stream.writeUint32(this.creation_time);
      stream.writeUint32(this.modification_time);
      stream.writeUint32(this.timescale);
      stream.writeUint32(this.duration);
      stream.writeUint32(this.rate);
      stream.writeUint16(this.volume << 8);
      stream.writeUint16(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32Array(this.matrix);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32(this.next_track_id);
    };
    BoxParser.SampleEntry.prototype.writeHeader = function(stream) {
      this.size = 8;
      BoxParser.Box.prototype.writeHeader.call(this, stream);
      stream.writeUint8(0);
      stream.writeUint8(0);
      stream.writeUint8(0);
      stream.writeUint8(0);
      stream.writeUint8(0);
      stream.writeUint8(0);
      stream.writeUint16(this.data_reference_index);
    };
    BoxParser.SampleEntry.prototype.writeFooter = function(stream) {
      for (var i2 = 0; i2 < this.boxes.length; i2++) {
        this.boxes[i2].write(stream);
        this.size += this.boxes[i2].size;
      }
      Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
      stream.adjustUint32(this.sizePosition, this.size);
    };
    BoxParser.SampleEntry.prototype.write = function(stream) {
      this.writeHeader(stream);
      stream.writeUint8Array(this.data);
      this.size += this.data.length;
      Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
      stream.adjustUint32(this.sizePosition, this.size);
    };
    BoxParser.VisualSampleEntry.prototype.write = function(stream) {
      this.writeHeader(stream);
      this.size += 2 * 7 + 6 * 4 + 32;
      stream.writeUint16(0);
      stream.writeUint16(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint16(this.width);
      stream.writeUint16(this.height);
      stream.writeUint32(this.horizresolution);
      stream.writeUint32(this.vertresolution);
      stream.writeUint32(0);
      stream.writeUint16(this.frame_count);
      stream.writeUint8(Math.min(31, this.compressorname.length));
      stream.writeString(this.compressorname, null, 31);
      stream.writeUint16(this.depth);
      stream.writeInt16(-1);
      this.writeFooter(stream);
    };
    BoxParser.AudioSampleEntry.prototype.write = function(stream) {
      this.writeHeader(stream);
      this.size += 2 * 4 + 3 * 4;
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeUint16(this.channel_count);
      stream.writeUint16(this.samplesize);
      stream.writeUint16(0);
      stream.writeUint16(0);
      stream.writeUint32(this.samplerate << 16);
      this.writeFooter(stream);
    };
    BoxParser.stppSampleEntry.prototype.write = function(stream) {
      this.writeHeader(stream);
      this.size += this.namespace.length + 1 + this.schema_location.length + 1 + this.auxiliary_mime_types.length + 1;
      stream.writeCString(this.namespace);
      stream.writeCString(this.schema_location);
      stream.writeCString(this.auxiliary_mime_types);
      this.writeFooter(stream);
    };
    BoxParser.SampleGroupEntry.prototype.write = function(stream) {
      stream.writeUint8Array(this.data);
    };
    BoxParser.sbgpBox.prototype.write = function(stream) {
      this.version = 1;
      this.flags = 0;
      this.size = 12 + 8 * this.entries.length;
      this.writeHeader(stream);
      stream.writeString(this.grouping_type, null, 4);
      stream.writeUint32(this.grouping_type_parameter);
      stream.writeUint32(this.entries.length);
      for (var i2 = 0; i2 < this.entries.length; i2++) {
        var entry = this.entries[i2];
        stream.writeInt32(entry.sample_count);
        stream.writeInt32(entry.group_description_index);
      }
    };
    BoxParser.sgpdBox.prototype.write = function(stream) {
      var i2;
      var entry;
      this.flags = 0;
      this.size = 12;
      for (i2 = 0; i2 < this.entries.length; i2++) {
        entry = this.entries[i2];
        if (this.version === 1) {
          if (this.default_length === 0) {
            this.size += 4;
          }
          this.size += entry.data.length;
        }
      }
      this.writeHeader(stream);
      stream.writeString(this.grouping_type, null, 4);
      if (this.version === 1) {
        stream.writeUint32(this.default_length);
      }
      if (this.version >= 2) {
        stream.writeUint32(this.default_sample_description_index);
      }
      stream.writeUint32(this.entries.length);
      for (i2 = 0; i2 < this.entries.length; i2++) {
        entry = this.entries[i2];
        if (this.version === 1) {
          if (this.default_length === 0) {
            stream.writeUint32(entry.description_length);
          }
        }
        entry.write(stream);
      }
    };
    BoxParser.sidxBox.prototype.write = function(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4 * 4 + 2 + 2 + 12 * this.references.length;
      this.writeHeader(stream);
      stream.writeUint32(this.reference_ID);
      stream.writeUint32(this.timescale);
      stream.writeUint32(this.earliest_presentation_time);
      stream.writeUint32(this.first_offset);
      stream.writeUint16(0);
      stream.writeUint16(this.references.length);
      for (var i2 = 0; i2 < this.references.length; i2++) {
        var ref = this.references[i2];
        stream.writeUint32(ref.reference_type << 31 | ref.referenced_size);
        stream.writeUint32(ref.subsegment_duration);
        stream.writeUint32(ref.starts_with_SAP << 31 | ref.SAP_type << 28 | ref.SAP_delta_time);
      }
    };
    BoxParser.smhdBox.prototype.write = function(stream) {
      var i2;
      this.version = 0;
      this.flags = 1;
      this.size = 4;
      this.writeHeader(stream);
      stream.writeUint16(this.balance);
      stream.writeUint16(0);
    };
    BoxParser.stcoBox.prototype.write = function(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 4 * this.chunk_offsets.length;
      this.writeHeader(stream);
      stream.writeUint32(this.chunk_offsets.length);
      stream.writeUint32Array(this.chunk_offsets);
    };
    BoxParser.stscBox.prototype.write = function(stream) {
      var i2;
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 12 * this.first_chunk.length;
      this.writeHeader(stream);
      stream.writeUint32(this.first_chunk.length);
      for (i2 = 0; i2 < this.first_chunk.length; i2++) {
        stream.writeUint32(this.first_chunk[i2]);
        stream.writeUint32(this.samples_per_chunk[i2]);
        stream.writeUint32(this.sample_description_index[i2]);
      }
    };
    BoxParser.stsdBox.prototype.write = function(stream) {
      var i2;
      this.version = 0;
      this.flags = 0;
      this.size = 0;
      this.writeHeader(stream);
      stream.writeUint32(this.entries.length);
      this.size += 4;
      for (i2 = 0; i2 < this.entries.length; i2++) {
        this.entries[i2].write(stream);
        this.size += this.entries[i2].size;
      }
      Log.debug("BoxWriter", "Adjusting box " + this.type + " with new size " + this.size);
      stream.adjustUint32(this.sizePosition, this.size);
    };
    BoxParser.stshBox.prototype.write = function(stream) {
      var i2;
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 8 * this.shadowed_sample_numbers.length;
      this.writeHeader(stream);
      stream.writeUint32(this.shadowed_sample_numbers.length);
      for (i2 = 0; i2 < this.shadowed_sample_numbers.length; i2++) {
        stream.writeUint32(this.shadowed_sample_numbers[i2]);
        stream.writeUint32(this.sync_sample_numbers[i2]);
      }
    };
    BoxParser.stssBox.prototype.write = function(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 4 * this.sample_numbers.length;
      this.writeHeader(stream);
      stream.writeUint32(this.sample_numbers.length);
      stream.writeUint32Array(this.sample_numbers);
    };
    BoxParser.stszBox.prototype.write = function(stream) {
      var i2;
      var constant = true;
      this.version = 0;
      this.flags = 0;
      if (this.sample_sizes.length > 0) {
        i2 = 0;
        while (i2 + 1 < this.sample_sizes.length) {
          if (this.sample_sizes[i2 + 1] !== this.sample_sizes[0]) {
            constant = false;
            break;
          } else {
            i2++;
          }
        }
      } else {
        constant = false;
      }
      this.size = 8;
      if (!constant) {
        this.size += 4 * this.sample_sizes.length;
      }
      this.writeHeader(stream);
      if (!constant) {
        stream.writeUint32(0);
      } else {
        stream.writeUint32(this.sample_sizes[0]);
      }
      stream.writeUint32(this.sample_sizes.length);
      if (!constant) {
        stream.writeUint32Array(this.sample_sizes);
      }
    };
    BoxParser.sttsBox.prototype.write = function(stream) {
      var i2;
      this.version = 0;
      this.flags = 0;
      this.size = 4 + 8 * this.sample_counts.length;
      this.writeHeader(stream);
      stream.writeUint32(this.sample_counts.length);
      for (i2 = 0; i2 < this.sample_counts.length; i2++) {
        stream.writeUint32(this.sample_counts[i2]);
        stream.writeUint32(this.sample_deltas[i2]);
      }
    };
    BoxParser.tfdtBox.prototype.write = function(stream) {
      var UINT32_MAX = Math.pow(2, 32) - 1;
      this.version = this.baseMediaDecodeTime > UINT32_MAX ? 1 : 0;
      this.flags = 0;
      this.size = 4;
      if (this.version === 1) {
        this.size += 4;
      }
      this.writeHeader(stream);
      if (this.version === 1) {
        stream.writeUint64(this.baseMediaDecodeTime);
      } else {
        stream.writeUint32(this.baseMediaDecodeTime);
      }
    };
    BoxParser.tfhdBox.prototype.write = function(stream) {
      this.version = 0;
      this.size = 4;
      if (this.flags & BoxParser.TFHD_FLAG_BASE_DATA_OFFSET) {
        this.size += 8;
      }
      if (this.flags & BoxParser.TFHD_FLAG_SAMPLE_DESC) {
        this.size += 4;
      }
      if (this.flags & BoxParser.TFHD_FLAG_SAMPLE_DUR) {
        this.size += 4;
      }
      if (this.flags & BoxParser.TFHD_FLAG_SAMPLE_SIZE) {
        this.size += 4;
      }
      if (this.flags & BoxParser.TFHD_FLAG_SAMPLE_FLAGS) {
        this.size += 4;
      }
      this.writeHeader(stream);
      stream.writeUint32(this.track_id);
      if (this.flags & BoxParser.TFHD_FLAG_BASE_DATA_OFFSET) {
        stream.writeUint64(this.base_data_offset);
      }
      if (this.flags & BoxParser.TFHD_FLAG_SAMPLE_DESC) {
        stream.writeUint32(this.default_sample_description_index);
      }
      if (this.flags & BoxParser.TFHD_FLAG_SAMPLE_DUR) {
        stream.writeUint32(this.default_sample_duration);
      }
      if (this.flags & BoxParser.TFHD_FLAG_SAMPLE_SIZE) {
        stream.writeUint32(this.default_sample_size);
      }
      if (this.flags & BoxParser.TFHD_FLAG_SAMPLE_FLAGS) {
        stream.writeUint32(this.default_sample_flags);
      }
    };
    BoxParser.tkhdBox.prototype.write = function(stream) {
      this.version = 0;
      this.size = 4 * 18 + 2 * 4;
      this.writeHeader(stream);
      stream.writeUint32(this.creation_time);
      stream.writeUint32(this.modification_time);
      stream.writeUint32(this.track_id);
      stream.writeUint32(0);
      stream.writeUint32(this.duration);
      stream.writeUint32(0);
      stream.writeUint32(0);
      stream.writeInt16(this.layer);
      stream.writeInt16(this.alternate_group);
      stream.writeInt16(this.volume << 8);
      stream.writeUint16(0);
      stream.writeInt32Array(this.matrix);
      stream.writeUint32(this.width);
      stream.writeUint32(this.height);
    };
    BoxParser.trexBox.prototype.write = function(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = 4 * 5;
      this.writeHeader(stream);
      stream.writeUint32(this.track_id);
      stream.writeUint32(this.default_sample_description_index);
      stream.writeUint32(this.default_sample_duration);
      stream.writeUint32(this.default_sample_size);
      stream.writeUint32(this.default_sample_flags);
    };
    BoxParser.trunBox.prototype.write = function(stream) {
      this.version = 0;
      this.size = 4;
      if (this.flags & BoxParser.TRUN_FLAGS_DATA_OFFSET) {
        this.size += 4;
      }
      if (this.flags & BoxParser.TRUN_FLAGS_FIRST_FLAG) {
        this.size += 4;
      }
      if (this.flags & BoxParser.TRUN_FLAGS_DURATION) {
        this.size += 4 * this.sample_duration.length;
      }
      if (this.flags & BoxParser.TRUN_FLAGS_SIZE) {
        this.size += 4 * this.sample_size.length;
      }
      if (this.flags & BoxParser.TRUN_FLAGS_FLAGS) {
        this.size += 4 * this.sample_flags.length;
      }
      if (this.flags & BoxParser.TRUN_FLAGS_CTS_OFFSET) {
        this.size += 4 * this.sample_composition_time_offset.length;
      }
      this.writeHeader(stream);
      stream.writeUint32(this.sample_count);
      if (this.flags & BoxParser.TRUN_FLAGS_DATA_OFFSET) {
        this.data_offset_position = stream.getPosition();
        stream.writeInt32(this.data_offset);
      }
      if (this.flags & BoxParser.TRUN_FLAGS_FIRST_FLAG) {
        stream.writeUint32(this.first_sample_flags);
      }
      for (var i2 = 0; i2 < this.sample_count; i2++) {
        if (this.flags & BoxParser.TRUN_FLAGS_DURATION) {
          stream.writeUint32(this.sample_duration[i2]);
        }
        if (this.flags & BoxParser.TRUN_FLAGS_SIZE) {
          stream.writeUint32(this.sample_size[i2]);
        }
        if (this.flags & BoxParser.TRUN_FLAGS_FLAGS) {
          stream.writeUint32(this.sample_flags[i2]);
        }
        if (this.flags & BoxParser.TRUN_FLAGS_CTS_OFFSET) {
          if (this.version === 0) {
            stream.writeUint32(this.sample_composition_time_offset[i2]);
          } else {
            stream.writeInt32(this.sample_composition_time_offset[i2]);
          }
        }
      }
    };
    BoxParser["url Box"].prototype.write = function(stream) {
      this.version = 0;
      if (this.location) {
        this.flags = 0;
        this.size = this.location.length + 1;
      } else {
        this.flags = 1;
        this.size = 0;
      }
      this.writeHeader(stream);
      if (this.location) {
        stream.writeCString(this.location);
      }
    };
    BoxParser["urn Box"].prototype.write = function(stream) {
      this.version = 0;
      this.flags = 0;
      this.size = this.name.length + 1 + (this.location ? this.location.length + 1 : 0);
      this.writeHeader(stream);
      stream.writeCString(this.name);
      if (this.location) {
        stream.writeCString(this.location);
      }
    };
    BoxParser.vmhdBox.prototype.write = function(stream) {
      var i2;
      this.version = 0;
      this.flags = 1;
      this.size = 8;
      this.writeHeader(stream);
      stream.writeUint16(this.graphicsmode);
      stream.writeUint16Array(this.opcolor);
    };
    BoxParser.vpcCBox.prototype.write = function(stream) {
      this.version = 1;
      const bodySize = 8 + this.codecIntializationDataSize;
      this.size = bodySize;
      this.writeHeader(stream);
      stream.writeUint8(this.profile);
      stream.writeUint8(this.level);
      let byte4 = this.bitDepth << 4 | (this.chromaSubsampling & 7) << 1 | this.videoFullRangeFlag & 1;
      stream.writeUint8(byte4);
      stream.writeUint8(this.colourPrimaries);
      stream.writeUint8(this.transferCharacteristics);
      stream.writeUint8(this.matrixCoefficients);
      stream.writeUint16(this.codecIntializationDataSize);
      if (this.codecIntializationDataSize > 0) {
        stream.writeUint8Array(this.codecIntializationData);
      }
    };
    BoxParser.cttsBox.prototype.unpack = function(samples) {
      var i2, j2, k2;
      k2 = 0;
      for (i2 = 0; i2 < this.sample_counts.length; i2++) {
        for (j2 = 0; j2 < this.sample_counts[i2]; j2++) {
          samples[k2].pts = samples[k2].dts + this.sample_offsets[i2];
          k2++;
        }
      }
    };
    BoxParser.sttsBox.prototype.unpack = function(samples) {
      var i2, j2, k2;
      k2 = 0;
      for (i2 = 0; i2 < this.sample_counts.length; i2++) {
        for (j2 = 0; j2 < this.sample_counts[i2]; j2++) {
          if (k2 === 0) {
            samples[k2].dts = 0;
          } else {
            samples[k2].dts = samples[k2 - 1].dts + this.sample_deltas[i2];
          }
          k2++;
        }
      }
    };
    BoxParser.stcoBox.prototype.unpack = function(samples) {
      var i2;
      for (i2 = 0; i2 < this.chunk_offsets.length; i2++) {
        samples[i2].offset = this.chunk_offsets[i2];
      }
    };
    BoxParser.stscBox.prototype.unpack = function(samples) {
      var i2, j2, k2, l2, m2;
      l2 = 0;
      m2 = 0;
      for (i2 = 0; i2 < this.first_chunk.length; i2++) {
        for (j2 = 0; j2 < (i2 + 1 < this.first_chunk.length ? this.first_chunk[i2 + 1] : Infinity); j2++) {
          m2++;
          for (k2 = 0; k2 < this.samples_per_chunk[i2]; k2++) {
            if (samples[l2]) {
              samples[l2].description_index = this.sample_description_index[i2];
              samples[l2].chunk_index = m2;
            } else {
              return;
            }
            l2++;
          }
        }
      }
    };
    BoxParser.stszBox.prototype.unpack = function(samples) {
      var i2;
      for (i2 = 0; i2 < this.sample_sizes.length; i2++) {
        samples[i2].size = this.sample_sizes[i2];
      }
    };
    BoxParser.DIFF_BOXES_PROP_NAMES = [
      "boxes",
      "entries",
      "references",
      "subsamples",
      "items",
      "item_infos",
      "extents",
      "associations",
      "subsegments",
      "ranges",
      "seekLists",
      "seekPoints",
      "esd",
      "levels"
    ];
    BoxParser.DIFF_PRIMITIVE_ARRAY_PROP_NAMES = [
      "compatible_brands",
      "matrix",
      "opcolor",
      "sample_counts",
      "sample_counts",
      "sample_deltas",
      "first_chunk",
      "samples_per_chunk",
      "sample_sizes",
      "chunk_offsets",
      "sample_offsets",
      "sample_description_index",
      "sample_duration"
    ];
    BoxParser.boxEqualFields = function(box_a, box_b) {
      if (box_a && !box_b) return false;
      var prop;
      for (prop in box_a) {
        if (BoxParser.DIFF_BOXES_PROP_NAMES.indexOf(prop) > -1) {
          continue;
        } else if (box_a[prop] instanceof BoxParser.Box || box_b[prop] instanceof BoxParser.Box) {
          continue;
        } else if (typeof box_a[prop] === "undefined" || typeof box_b[prop] === "undefined") {
          continue;
        } else if (typeof box_a[prop] === "function" || typeof box_b[prop] === "function") {
          continue;
        } else if (box_a.subBoxNames && box_a.subBoxNames.indexOf(prop.slice(0, 4)) > -1 || box_b.subBoxNames && box_b.subBoxNames.indexOf(prop.slice(0, 4)) > -1) {
          continue;
        } else {
          if (prop === "data" || prop === "start" || prop === "size" || prop === "creation_time" || prop === "modification_time") {
            continue;
          } else if (BoxParser.DIFF_PRIMITIVE_ARRAY_PROP_NAMES.indexOf(prop) > -1) {
            continue;
          } else {
            if (box_a[prop] !== box_b[prop]) {
              return false;
            }
          }
        }
      }
      return true;
    };
    BoxParser.boxEqual = function(box_a, box_b) {
      if (!BoxParser.boxEqualFields(box_a, box_b)) {
        return false;
      }
      for (var j2 = 0; j2 < BoxParser.DIFF_BOXES_PROP_NAMES.length; j2++) {
        var name = BoxParser.DIFF_BOXES_PROP_NAMES[j2];
        if (box_a[name] && box_b[name]) {
          if (!BoxParser.boxEqual(box_a[name], box_b[name])) {
            return false;
          }
        }
      }
      return true;
    };
    var VTTin4Parser = function() {
    };
    VTTin4Parser.prototype.parseSample = function(data) {
      var cues, cue;
      var stream = new MP4BoxStream(data.buffer);
      cues = [];
      while (!stream.isEos()) {
        cue = BoxParser.parseOneBox(stream, false);
        if (cue.code === BoxParser.OK && cue.box.type === "vttc") {
          cues.push(cue.box);
        }
      }
      return cues;
    };
    VTTin4Parser.prototype.getText = function(startTime, endTime, data) {
      function pad(n2, width, z3) {
        z3 = z3 || "0";
        n2 = n2 + "";
        return n2.length >= width ? n2 : new Array(width - n2.length + 1).join(z3) + n2;
      }
      function secToTimestamp(insec) {
        var h = Math.floor(insec / 3600);
        var m2 = Math.floor((insec - h * 3600) / 60);
        var s = Math.floor(insec - h * 3600 - m2 * 60);
        var ms = Math.floor((insec - h * 3600 - m2 * 60 - s) * 1e3);
        return "" + pad(h, 2) + ":" + pad(m2, 2) + ":" + pad(s, 2) + "." + pad(ms, 3);
      }
      var cues = this.parseSample(data);
      var string = "";
      for (var i2 = 0; i2 < cues.length; i2++) {
        var cueIn4 = cues[i2];
        string += secToTimestamp(startTime) + " --> " + secToTimestamp(endTime) + "\r\n";
        string += cueIn4.payl.text;
      }
      return string;
    };
    var XMLSubtitlein4Parser = function() {
    };
    XMLSubtitlein4Parser.prototype.parseSample = function(sample) {
      var res = {};
      var i2;
      res.resources = [];
      var stream = new MP4BoxStream(sample.data.buffer);
      if (!sample.subsamples || sample.subsamples.length === 0) {
        res.documentString = stream.readString(sample.data.length);
      } else {
        res.documentString = stream.readString(sample.subsamples[0].size);
        if (sample.subsamples.length > 1) {
          for (i2 = 1; i2 < sample.subsamples.length; i2++) {
            res.resources[i2] = stream.readUint8Array(sample.subsamples[i2].size);
          }
        }
      }
      if (typeof DOMParser !== "undefined") {
        res.document = new DOMParser().parseFromString(res.documentString, "application/xml");
      }
      return res;
    };
    var Textin4Parser = function() {
    };
    Textin4Parser.prototype.parseSample = function(sample) {
      var textString;
      var stream = new MP4BoxStream(sample.data.buffer);
      textString = stream.readString(sample.data.length);
      return textString;
    };
    Textin4Parser.prototype.parseConfig = function(data) {
      var textString;
      var stream = new MP4BoxStream(data.buffer);
      stream.readUint32();
      textString = stream.readCString();
      return textString;
    };
    if (typeof exports !== "undefined") {
      exports.XMLSubtitlein4Parser = XMLSubtitlein4Parser;
      exports.Textin4Parser = Textin4Parser;
    }
    var ISOFile = function(stream) {
      this.stream = stream || new MultiBufferStream();
      this.boxes = [];
      this.mdats = [];
      this.moofs = [];
      this.isProgressive = false;
      this.moovStartFound = false;
      this.onMoovStart = null;
      this.moovStartSent = false;
      this.onReady = null;
      this.readySent = false;
      this.onSegment = null;
      this.onSamples = null;
      this.onError = null;
      this.sampleListBuilt = false;
      this.fragmentedTracks = [];
      this.extractedTracks = [];
      this.isFragmentationInitialized = false;
      this.sampleProcessingStarted = false;
      this.nextMoofNumber = 0;
      this.itemListBuilt = false;
      this.onSidx = null;
      this.sidxSent = false;
    };
    ISOFile.prototype.setSegmentOptions = function(id, user, options) {
      var trak = this.getTrackById(id);
      if (trak) {
        var fragTrack = {};
        this.fragmentedTracks.push(fragTrack);
        fragTrack.id = id;
        fragTrack.user = user;
        fragTrack.trak = trak;
        trak.nextSample = 0;
        fragTrack.segmentStream = null;
        fragTrack.nb_samples = 1e3;
        fragTrack.rapAlignement = true;
        if (options) {
          if (options.nbSamples) fragTrack.nb_samples = options.nbSamples;
          if (options.rapAlignement) fragTrack.rapAlignement = options.rapAlignement;
        }
      }
    };
    ISOFile.prototype.unsetSegmentOptions = function(id) {
      var index = -1;
      for (var i2 = 0; i2 < this.fragmentedTracks.length; i2++) {
        var fragTrack = this.fragmentedTracks[i2];
        if (fragTrack.id == id) {
          index = i2;
        }
      }
      if (index > -1) {
        this.fragmentedTracks.splice(index, 1);
      }
    };
    ISOFile.prototype.setExtractionOptions = function(id, user, options) {
      var trak = this.getTrackById(id);
      if (trak) {
        var extractTrack = {};
        this.extractedTracks.push(extractTrack);
        extractTrack.id = id;
        extractTrack.user = user;
        extractTrack.trak = trak;
        trak.nextSample = 0;
        extractTrack.nb_samples = 1e3;
        extractTrack.samples = [];
        if (options) {
          if (options.nbSamples) extractTrack.nb_samples = options.nbSamples;
        }
      }
    };
    ISOFile.prototype.unsetExtractionOptions = function(id) {
      var index = -1;
      for (var i2 = 0; i2 < this.extractedTracks.length; i2++) {
        var extractTrack = this.extractedTracks[i2];
        if (extractTrack.id == id) {
          index = i2;
        }
      }
      if (index > -1) {
        this.extractedTracks.splice(index, 1);
      }
    };
    ISOFile.prototype.parse = function() {
      var found;
      var ret2;
      var box2;
      var parseBoxHeadersOnly = false;
      if (this.restoreParsePosition) {
        if (!this.restoreParsePosition()) {
          return;
        }
      }
      while (true) {
        if (this.hasIncompleteMdat && this.hasIncompleteMdat()) {
          if (this.processIncompleteMdat()) {
            continue;
          } else {
            return;
          }
        } else {
          if (this.saveParsePosition) {
            this.saveParsePosition();
          }
          ret2 = BoxParser.parseOneBox(this.stream, parseBoxHeadersOnly);
          if (ret2.code === BoxParser.ERR_NOT_ENOUGH_DATA) {
            if (this.processIncompleteBox) {
              if (this.processIncompleteBox(ret2)) {
                continue;
              } else {
                return;
              }
            } else {
              return;
            }
          } else {
            var box_type;
            box2 = ret2.box;
            box_type = box2.type !== "uuid" ? box2.type : box2.uuid;
            this.boxes.push(box2);
            switch (box_type) {
              case "mdat":
                this.mdats.push(box2);
                break;
              case "moof":
                this.moofs.push(box2);
                break;
              case "moov":
                this.moovStartFound = true;
                if (this.mdats.length === 0) {
                  this.isProgressive = true;
                }
              /* no break */
              /* falls through */
              default:
                if (this[box_type] !== void 0) {
                  Log.warn("ISOFile", "Duplicate Box of type: " + box_type + ", overriding previous occurrence");
                }
                this[box_type] = box2;
                break;
            }
            if (this.updateUsedBytes) {
              this.updateUsedBytes(box2, ret2);
            }
          }
        }
      }
    };
    ISOFile.prototype.checkBuffer = function(ab) {
      if (ab === null || ab === void 0) {
        throw "Buffer must be defined and non empty";
      }
      if (ab.fileStart === void 0) {
        throw "Buffer must have a fileStart property";
      }
      if (ab.byteLength === 0) {
        Log.warn("ISOFile", "Ignoring empty buffer (fileStart: " + ab.fileStart + ")");
        this.stream.logBufferLevel();
        return false;
      }
      Log.info("ISOFile", "Processing buffer (fileStart: " + ab.fileStart + ")");
      ab.usedBytes = 0;
      this.stream.insertBuffer(ab);
      this.stream.logBufferLevel();
      if (!this.stream.initialized()) {
        Log.warn("ISOFile", "Not ready to start parsing");
        return false;
      }
      return true;
    };
    ISOFile.prototype.appendBuffer = function(ab, last) {
      var nextFileStart;
      if (!this.checkBuffer(ab)) {
        return;
      }
      this.parse();
      if (this.moovStartFound && !this.moovStartSent) {
        this.moovStartSent = true;
        if (this.onMoovStart) this.onMoovStart();
      }
      if (this.moov) {
        if (!this.sampleListBuilt) {
          this.buildSampleLists();
          this.sampleListBuilt = true;
        }
        this.updateSampleLists();
        if (this.onReady && !this.readySent) {
          this.readySent = true;
          this.onReady(this.getInfo());
        }
        this.processSamples(last);
        if (this.nextSeekPosition) {
          nextFileStart = this.nextSeekPosition;
          this.nextSeekPosition = void 0;
        } else {
          nextFileStart = this.nextParsePosition;
        }
        if (this.stream.getEndFilePositionAfter) {
          nextFileStart = this.stream.getEndFilePositionAfter(nextFileStart);
        }
      } else {
        if (this.nextParsePosition) {
          nextFileStart = this.nextParsePosition;
        } else {
          nextFileStart = 0;
        }
      }
      if (this.sidx) {
        if (this.onSidx && !this.sidxSent) {
          this.onSidx(this.sidx);
          this.sidxSent = true;
        }
      }
      if (this.meta) {
        if (this.flattenItemInfo && !this.itemListBuilt) {
          this.flattenItemInfo();
          this.itemListBuilt = true;
        }
        if (this.processItems) {
          this.processItems(this.onItem);
        }
      }
      if (this.stream.cleanBuffers) {
        Log.info("ISOFile", "Done processing buffer (fileStart: " + ab.fileStart + ") - next buffer to fetch should have a fileStart position of " + nextFileStart);
        this.stream.logBufferLevel();
        this.stream.cleanBuffers();
        this.stream.logBufferLevel(true);
        Log.info("ISOFile", "Sample data size in memory: " + this.getAllocatedSampleDataSize());
      }
      return nextFileStart;
    };
    ISOFile.prototype.getInfo = function() {
      var i2, j2;
      var movie = {};
      var trak;
      var track;
      var ref;
      var sample_desc;
      var _1904 = (/* @__PURE__ */ new Date("1904-01-01T00:00:00Z")).getTime();
      if (this.moov) {
        movie.hasMoov = true;
        movie.duration = this.moov.mvhd.duration;
        movie.timescale = this.moov.mvhd.timescale;
        movie.isFragmented = this.moov.mvex != null;
        if (movie.isFragmented && this.moov.mvex.mehd) {
          movie.fragment_duration = this.moov.mvex.mehd.fragment_duration;
        }
        movie.isProgressive = this.isProgressive;
        movie.hasIOD = this.moov.iods != null;
        movie.brands = [];
        movie.brands.push(this.ftyp.major_brand);
        movie.brands = movie.brands.concat(this.ftyp.compatible_brands);
        movie.created = new Date(_1904 + this.moov.mvhd.creation_time * 1e3);
        movie.modified = new Date(_1904 + this.moov.mvhd.modification_time * 1e3);
        movie.tracks = [];
        movie.audioTracks = [];
        movie.videoTracks = [];
        movie.subtitleTracks = [];
        movie.metadataTracks = [];
        movie.hintTracks = [];
        movie.otherTracks = [];
        for (i2 = 0; i2 < this.moov.traks.length; i2++) {
          trak = this.moov.traks[i2];
          sample_desc = trak.mdia.minf.stbl.stsd.entries[0];
          track = {};
          movie.tracks.push(track);
          track.id = trak.tkhd.track_id;
          track.name = trak.mdia.hdlr.name;
          track.references = [];
          if (trak.tref) {
            for (j2 = 0; j2 < trak.tref.boxes.length; j2++) {
              ref = {};
              track.references.push(ref);
              ref.type = trak.tref.boxes[j2].type;
              ref.track_ids = trak.tref.boxes[j2].track_ids;
            }
          }
          if (trak.edts) {
            track.edits = trak.edts.elst.entries;
          }
          track.created = new Date(_1904 + trak.tkhd.creation_time * 1e3);
          track.modified = new Date(_1904 + trak.tkhd.modification_time * 1e3);
          track.movie_duration = trak.tkhd.duration;
          track.movie_timescale = movie.timescale;
          track.layer = trak.tkhd.layer;
          track.alternate_group = trak.tkhd.alternate_group;
          track.volume = trak.tkhd.volume;
          track.matrix = trak.tkhd.matrix;
          track.track_width = trak.tkhd.width / (1 << 16);
          track.track_height = trak.tkhd.height / (1 << 16);
          track.timescale = trak.mdia.mdhd.timescale;
          track.cts_shift = trak.mdia.minf.stbl.cslg;
          track.duration = trak.mdia.mdhd.duration;
          track.samples_duration = trak.samples_duration;
          track.codec = sample_desc.getCodec();
          track.kind = trak.udta && trak.udta.kinds.length ? trak.udta.kinds[0] : { schemeURI: "", value: "" };
          track.language = trak.mdia.elng ? trak.mdia.elng.extended_language : trak.mdia.mdhd.languageString;
          track.nb_samples = trak.samples.length;
          track.size = trak.samples_size;
          track.bitrate = track.size * 8 * track.timescale / track.samples_duration;
          if (sample_desc.isAudio()) {
            track.type = "audio";
            movie.audioTracks.push(track);
            track.audio = {};
            track.audio.sample_rate = sample_desc.getSampleRate();
            track.audio.channel_count = sample_desc.getChannelCount();
            track.audio.sample_size = sample_desc.getSampleSize();
          } else if (sample_desc.isVideo()) {
            track.type = "video";
            movie.videoTracks.push(track);
            track.video = {};
            track.video.width = sample_desc.getWidth();
            track.video.height = sample_desc.getHeight();
          } else if (sample_desc.isSubtitle()) {
            track.type = "subtitles";
            movie.subtitleTracks.push(track);
          } else if (sample_desc.isHint()) {
            track.type = "metadata";
            movie.hintTracks.push(track);
          } else if (sample_desc.isMetadata()) {
            track.type = "metadata";
            movie.metadataTracks.push(track);
          } else {
            track.type = "metadata";
            movie.otherTracks.push(track);
          }
        }
      } else {
        movie.hasMoov = false;
      }
      movie.mime = "";
      if (movie.hasMoov && movie.tracks) {
        if (movie.videoTracks && movie.videoTracks.length > 0) {
          movie.mime += 'video/mp4; codecs="';
        } else if (movie.audioTracks && movie.audioTracks.length > 0) {
          movie.mime += 'audio/mp4; codecs="';
        } else {
          movie.mime += 'application/mp4; codecs="';
        }
        for (i2 = 0; i2 < movie.tracks.length; i2++) {
          if (i2 !== 0) movie.mime += ",";
          movie.mime += movie.tracks[i2].codec;
        }
        movie.mime += '"; profiles="';
        movie.mime += this.ftyp.compatible_brands.join();
        movie.mime += '"';
      }
      return movie;
    };
    ISOFile.prototype.setNextSeekPositionFromSample = function(sample) {
      if (!sample) {
        return;
      }
      if (this.nextSeekPosition) {
        this.nextSeekPosition = Math.min(sample.offset + sample.alreadyRead, this.nextSeekPosition);
      } else {
        this.nextSeekPosition = sample.offset + sample.alreadyRead;
      }
    };
    ISOFile.prototype.processSamples = function(last) {
      var i2;
      var trak;
      if (!this.sampleProcessingStarted) return;
      if (this.isFragmentationInitialized && this.onSegment !== null) {
        for (i2 = 0; i2 < this.fragmentedTracks.length; i2++) {
          var fragTrak = this.fragmentedTracks[i2];
          trak = fragTrak.trak;
          while (trak.nextSample < trak.samples.length && this.sampleProcessingStarted) {
            Log.debug("ISOFile", "Creating media fragment on track #" + fragTrak.id + " for sample " + trak.nextSample);
            var result = this.createFragment(fragTrak.id, trak.nextSample, fragTrak.segmentStream);
            if (result) {
              fragTrak.segmentStream = result;
              trak.nextSample++;
            } else {
              break;
            }
            if (trak.nextSample % fragTrak.nb_samples === 0 || (last || trak.nextSample >= trak.samples.length)) {
              Log.info("ISOFile", "Sending fragmented data on track #" + fragTrak.id + " for samples [" + Math.max(0, trak.nextSample - fragTrak.nb_samples) + "," + (trak.nextSample - 1) + "]");
              Log.info("ISOFile", "Sample data size in memory: " + this.getAllocatedSampleDataSize());
              if (this.onSegment) {
                this.onSegment(fragTrak.id, fragTrak.user, fragTrak.segmentStream.buffer, trak.nextSample, last || trak.nextSample >= trak.samples.length);
              }
              fragTrak.segmentStream = null;
              if (fragTrak !== this.fragmentedTracks[i2]) {
                break;
              }
            }
          }
        }
      }
      if (this.onSamples !== null) {
        for (i2 = 0; i2 < this.extractedTracks.length; i2++) {
          var extractTrak = this.extractedTracks[i2];
          trak = extractTrak.trak;
          while (trak.nextSample < trak.samples.length && this.sampleProcessingStarted) {
            Log.debug("ISOFile", "Exporting on track #" + extractTrak.id + " sample #" + trak.nextSample);
            var sample = this.getSample(trak, trak.nextSample);
            if (sample) {
              trak.nextSample++;
              extractTrak.samples.push(sample);
            } else {
              this.setNextSeekPositionFromSample(trak.samples[trak.nextSample]);
              break;
            }
            if (trak.nextSample % extractTrak.nb_samples === 0 || trak.nextSample >= trak.samples.length) {
              Log.debug("ISOFile", "Sending samples on track #" + extractTrak.id + " for sample " + trak.nextSample);
              if (this.onSamples) {
                this.onSamples(extractTrak.id, extractTrak.user, extractTrak.samples);
              }
              extractTrak.samples = [];
              if (extractTrak !== this.extractedTracks[i2]) {
                break;
              }
            }
          }
        }
      }
    };
    ISOFile.prototype.getBox = function(type) {
      var result = this.getBoxes(type, true);
      return result.length ? result[0] : null;
    };
    ISOFile.prototype.getBoxes = function(type, returnEarly) {
      var result = [];
      ISOFile._sweep.call(this, type, result, returnEarly);
      return result;
    };
    ISOFile._sweep = function(type, result, returnEarly) {
      if (this.type && this.type == type) result.push(this);
      for (var box2 in this.boxes) {
        if (result.length && returnEarly) return;
        ISOFile._sweep.call(this.boxes[box2], type, result, returnEarly);
      }
    };
    ISOFile.prototype.getTrackSamplesInfo = function(track_id) {
      var track = this.getTrackById(track_id);
      if (track) {
        return track.samples;
      } else {
        return;
      }
    };
    ISOFile.prototype.getTrackSample = function(track_id, number) {
      var track = this.getTrackById(track_id);
      var sample = this.getSample(track, number);
      return sample;
    };
    ISOFile.prototype.releaseUsedSamples = function(id, sampleNum) {
      var size = 0;
      var trak = this.getTrackById(id);
      if (!trak.lastValidSample) trak.lastValidSample = 0;
      for (var i2 = trak.lastValidSample; i2 < sampleNum; i2++) {
        size += this.releaseSample(trak, i2);
      }
      Log.info("ISOFile", "Track #" + id + " released samples up to " + sampleNum + " (released size: " + size + ", remaining: " + this.samplesDataSize + ")");
      trak.lastValidSample = sampleNum;
    };
    ISOFile.prototype.start = function() {
      this.sampleProcessingStarted = true;
      this.processSamples(false);
    };
    ISOFile.prototype.stop = function() {
      this.sampleProcessingStarted = false;
    };
    ISOFile.prototype.flush = function() {
      Log.info("ISOFile", "Flushing remaining samples");
      this.updateSampleLists();
      this.processSamples(true);
      this.stream.cleanBuffers();
      this.stream.logBufferLevel(true);
    };
    ISOFile.prototype.seekTrack = function(time, useRap, trak) {
      var j2;
      var sample;
      var seek_offset = Infinity;
      var rap_seek_sample_num = 0;
      var seek_sample_num = 0;
      var timescale;
      if (trak.samples.length === 0) {
        Log.info("ISOFile", "No sample in track, cannot seek! Using time " + Log.getDurationString(0, 1) + " and offset: 0");
        return { offset: 0, time: 0 };
      }
      for (j2 = 0; j2 < trak.samples.length; j2++) {
        sample = trak.samples[j2];
        if (j2 === 0) {
          seek_sample_num = 0;
          timescale = sample.timescale;
        } else if (sample.cts > time * sample.timescale) {
          seek_sample_num = j2 - 1;
          break;
        }
        if (useRap && sample.is_sync) {
          rap_seek_sample_num = j2;
        }
      }
      if (useRap) {
        seek_sample_num = rap_seek_sample_num;
      }
      time = trak.samples[seek_sample_num].cts;
      trak.nextSample = seek_sample_num;
      while (trak.samples[seek_sample_num].alreadyRead === trak.samples[seek_sample_num].size) {
        if (!trak.samples[seek_sample_num + 1]) {
          break;
        }
        seek_sample_num++;
      }
      seek_offset = trak.samples[seek_sample_num].offset + trak.samples[seek_sample_num].alreadyRead;
      Log.info("ISOFile", "Seeking to " + (useRap ? "RAP" : "") + " sample #" + trak.nextSample + " on track " + trak.tkhd.track_id + ", time " + Log.getDurationString(time, timescale) + " and offset: " + seek_offset);
      return { offset: seek_offset, time: time / timescale };
    };
    ISOFile.prototype.getTrackDuration = function(trak) {
      var sample;
      if (!trak.samples) {
        return Infinity;
      }
      sample = trak.samples[trak.samples.length - 1];
      return (sample.cts + sample.duration) / sample.timescale;
    };
    ISOFile.prototype.seek = function(time, useRap) {
      var moov = this.moov;
      var trak;
      var trak_seek_info;
      var i2;
      var seek_info = { offset: Infinity, time: Infinity };
      if (!this.moov) {
        throw "Cannot seek: moov not received!";
      } else {
        for (i2 = 0; i2 < moov.traks.length; i2++) {
          trak = moov.traks[i2];
          if (time > this.getTrackDuration(trak)) {
            continue;
          }
          trak_seek_info = this.seekTrack(time, useRap, trak);
          if (trak_seek_info.offset < seek_info.offset) {
            seek_info.offset = trak_seek_info.offset;
          }
          if (trak_seek_info.time < seek_info.time) {
            seek_info.time = trak_seek_info.time;
          }
        }
        Log.info("ISOFile", "Seeking at time " + Log.getDurationString(seek_info.time, 1) + " needs a buffer with a fileStart position of " + seek_info.offset);
        if (seek_info.offset === Infinity) {
          seek_info = { offset: this.nextParsePosition, time: 0 };
        } else {
          seek_info.offset = this.stream.getEndFilePositionAfter(seek_info.offset);
        }
        Log.info("ISOFile", "Adjusted seek position (after checking data already in buffer): " + seek_info.offset);
        return seek_info;
      }
    };
    ISOFile.prototype.equal = function(b) {
      var box_index = 0;
      while (box_index < this.boxes.length && box_index < b.boxes.length) {
        var a_box = this.boxes[box_index];
        var b_box = b.boxes[box_index];
        if (!BoxParser.boxEqual(a_box, b_box)) {
          return false;
        }
        box_index++;
      }
      return true;
    };
    if (typeof exports !== "undefined") {
      exports.ISOFile = ISOFile;
    }
    ISOFile.prototype.lastBoxStartPosition = 0;
    ISOFile.prototype.parsingMdat = null;
    ISOFile.prototype.nextParsePosition = 0;
    ISOFile.prototype.discardMdatData = false;
    ISOFile.prototype.processIncompleteBox = function(ret2) {
      var box2;
      var merged;
      var found;
      if (ret2.type === "mdat") {
        box2 = new BoxParser[ret2.type + "Box"](ret2.size);
        this.parsingMdat = box2;
        this.boxes.push(box2);
        this.mdats.push(box2);
        box2.start = ret2.start;
        box2.hdr_size = ret2.hdr_size;
        this.stream.addUsedBytes(box2.hdr_size);
        this.lastBoxStartPosition = box2.start + box2.size;
        found = this.stream.seek(box2.start + box2.size, false, this.discardMdatData);
        if (found) {
          this.parsingMdat = null;
          return true;
        } else {
          if (!this.moovStartFound) {
            this.nextParsePosition = box2.start + box2.size;
          } else {
            this.nextParsePosition = this.stream.findEndContiguousBuf();
          }
          return false;
        }
      } else {
        if (ret2.type === "moov") {
          this.moovStartFound = true;
          if (this.mdats.length === 0) {
            this.isProgressive = true;
          }
        }
        merged = this.stream.mergeNextBuffer ? this.stream.mergeNextBuffer() : false;
        if (merged) {
          this.nextParsePosition = this.stream.getEndPosition();
          return true;
        } else {
          if (!ret2.type) {
            this.nextParsePosition = this.stream.getEndPosition();
          } else {
            if (this.moovStartFound) {
              this.nextParsePosition = this.stream.getEndPosition();
            } else {
              this.nextParsePosition = this.stream.getPosition() + ret2.size;
            }
          }
          return false;
        }
      }
    };
    ISOFile.prototype.hasIncompleteMdat = function() {
      return this.parsingMdat !== null;
    };
    ISOFile.prototype.processIncompleteMdat = function() {
      var box2;
      var found;
      box2 = this.parsingMdat;
      found = this.stream.seek(box2.start + box2.size, false, this.discardMdatData);
      if (found) {
        Log.debug("ISOFile", "Found 'mdat' end in buffered data");
        this.parsingMdat = null;
        return true;
      } else {
        this.nextParsePosition = this.stream.findEndContiguousBuf();
        return false;
      }
    };
    ISOFile.prototype.restoreParsePosition = function() {
      return this.stream.seek(this.lastBoxStartPosition, true, this.discardMdatData);
    };
    ISOFile.prototype.saveParsePosition = function() {
      this.lastBoxStartPosition = this.stream.getPosition();
    };
    ISOFile.prototype.updateUsedBytes = function(box2, ret2) {
      if (this.stream.addUsedBytes) {
        if (box2.type === "mdat") {
          this.stream.addUsedBytes(box2.hdr_size);
          if (this.discardMdatData) {
            this.stream.addUsedBytes(box2.size - box2.hdr_size);
          }
        } else {
          this.stream.addUsedBytes(box2.size);
        }
      }
    };
    ISOFile.prototype.add = BoxParser.Box.prototype.add;
    ISOFile.prototype.addBox = BoxParser.Box.prototype.addBox;
    ISOFile.prototype.init = function(_options) {
      var options = _options || {};
      var ftyp = this.add("ftyp").set("major_brand", options.brands && options.brands[0] || "iso4").set("minor_version", 0).set("compatible_brands", options.brands || ["iso4"]);
      var moov = this.add("moov");
      moov.add("mvhd").set("timescale", options.timescale || 600).set("rate", options.rate || 1 << 16).set("creation_time", 0).set("modification_time", 0).set("duration", options.duration || 0).set("volume", options.width ? 0 : 256).set("matrix", [1 << 16, 0, 0, 0, 1 << 16, 0, 0, 0, 1073741824]).set("next_track_id", 1);
      moov.add("mvex");
      return this;
    };
    ISOFile.prototype.addTrack = function(_options) {
      if (!this.moov) {
        this.init(_options);
      }
      var options = _options || {};
      options.width = options.width || 320;
      options.height = options.height || 320;
      options.id = options.id || this.moov.mvhd.next_track_id;
      options.type = options.type || "avc1";
      var trak = this.moov.add("trak");
      this.moov.mvhd.next_track_id = options.id + 1;
      trak.add("tkhd").set("flags", BoxParser.TKHD_FLAG_ENABLED | BoxParser.TKHD_FLAG_IN_MOVIE | BoxParser.TKHD_FLAG_IN_PREVIEW).set("creation_time", 0).set("modification_time", 0).set("track_id", options.id).set("duration", options.duration || 0).set("layer", options.layer || 0).set("alternate_group", 0).set("volume", 1).set("matrix", [1 << 16, 0, 0, 0, 1 << 16, 0, 0, 0, 1073741824]).set("width", options.width << 16).set("height", options.height << 16);
      var mdia = trak.add("mdia");
      mdia.add("mdhd").set("creation_time", 0).set("modification_time", 0).set("timescale", options.timescale || 1).set("duration", options.media_duration || 0).set("language", options.language || "und");
      mdia.add("hdlr").set("handler", options.hdlr || "vide").set("name", options.name || "Track created with MP4Box.js");
      mdia.add("elng").set("extended_language", options.language || "fr-FR");
      var minf = mdia.add("minf");
      if (BoxParser[options.type + "SampleEntry"] === void 0) return;
      var sample_description_entry = new BoxParser[options.type + "SampleEntry"]();
      sample_description_entry.data_reference_index = 1;
      var media_type = "";
      for (var mediaType in BoxParser.sampleEntryCodes) {
        var codes = BoxParser.sampleEntryCodes[mediaType];
        for (var i2 = 0; i2 < codes.length; i2++) {
          if (codes.indexOf(options.type) > -1) {
            media_type = mediaType;
            break;
          }
        }
      }
      switch (media_type) {
        case "Visual":
          minf.add("vmhd").set("graphicsmode", 0).set("opcolor", [0, 0, 0]);
          sample_description_entry.set("width", options.width).set("height", options.height).set("horizresolution", 72 << 16).set("vertresolution", 72 << 16).set("frame_count", 1).set("compressorname", options.type + " Compressor").set("depth", 24);
          if (options.avcDecoderConfigRecord) {
            var avcC = new BoxParser.avcCBox();
            avcC.parse(new MP4BoxStream(options.avcDecoderConfigRecord));
            sample_description_entry.addBox(avcC);
          } else if (options.hevcDecoderConfigRecord) {
            var hvcC = new BoxParser.hvcCBox();
            hvcC.parse(new MP4BoxStream(options.hevcDecoderConfigRecord));
            sample_description_entry.addBox(hvcC);
          } else if (options.vpcDecoderConfigRecord) {
            var vpcC = new BoxParser.vpcCBox();
            vpcC.parse(new MP4BoxStream(options.vpcDecoderConfigRecord));
            sample_description_entry.addBox(vpcC);
          }
          break;
        case "Audio":
          minf.add("smhd").set("balance", options.balance || 0);
          sample_description_entry.set("channel_count", options.channel_count || 2).set("samplesize", options.samplesize || 16).set("samplerate", options.samplerate || 1 << 16);
          break;
        case "Hint":
          minf.add("hmhd");
          break;
        case "Subtitle":
          minf.add("sthd");
          switch (options.type) {
            case "stpp":
              sample_description_entry.set("namespace", options.namespace || "nonamespace").set("schema_location", options.schema_location || "").set("auxiliary_mime_types", options.auxiliary_mime_types || "");
              break;
          }
          break;
        case "Metadata":
          minf.add("nmhd");
          break;
        case "System":
          minf.add("nmhd");
          break;
        default:
          minf.add("nmhd");
          break;
      }
      if (options.description) {
        sample_description_entry.addBox(options.description);
      }
      if (options.description_boxes) {
        options.description_boxes.forEach(function(b) {
          sample_description_entry.addBox(b);
        });
      }
      minf.add("dinf").add("dref").addEntry(new BoxParser["url Box"]().set("flags", 1));
      var stbl = minf.add("stbl");
      stbl.add("stsd").addEntry(sample_description_entry);
      stbl.add("stts").set("sample_counts", []).set("sample_deltas", []);
      stbl.add("stsc").set("first_chunk", []).set("samples_per_chunk", []).set("sample_description_index", []);
      stbl.add("stco").set("chunk_offsets", []);
      stbl.add("stsz").set("sample_sizes", []);
      this.moov.mvex.add("trex").set("track_id", options.id).set("default_sample_description_index", options.default_sample_description_index || 1).set("default_sample_duration", options.default_sample_duration || 0).set("default_sample_size", options.default_sample_size || 0).set("default_sample_flags", options.default_sample_flags || 0);
      this.buildTrakSampleLists(trak);
      return options.id;
    };
    BoxParser.Box.prototype.computeSize = function(stream_) {
      var stream = stream_ || new DataStream();
      stream.endianness = DataStream.BIG_ENDIAN;
      this.write(stream);
    };
    ISOFile.prototype.addSample = function(track_id, data, _options) {
      var options = _options || {};
      var sample = {};
      var trak = this.getTrackById(track_id);
      if (trak === null) return;
      sample.number = trak.samples.length;
      sample.track_id = trak.tkhd.track_id;
      sample.timescale = trak.mdia.mdhd.timescale;
      sample.description_index = options.sample_description_index ? options.sample_description_index - 1 : 0;
      sample.description = trak.mdia.minf.stbl.stsd.entries[sample.description_index];
      sample.data = data;
      sample.size = data.byteLength;
      sample.alreadyRead = sample.size;
      sample.duration = options.duration || 1;
      sample.cts = options.cts || 0;
      sample.dts = options.dts || 0;
      sample.is_sync = options.is_sync || false;
      sample.is_leading = options.is_leading || 0;
      sample.depends_on = options.depends_on || 0;
      sample.is_depended_on = options.is_depended_on || 0;
      sample.has_redundancy = options.has_redundancy || 0;
      sample.degradation_priority = options.degradation_priority || 0;
      sample.offset = 0;
      sample.subsamples = options.subsamples;
      trak.samples.push(sample);
      trak.samples_size += sample.size;
      trak.samples_duration += sample.duration;
      if (trak.first_dts === void 0) {
        trak.first_dts = options.dts;
      }
      this.processSamples();
      var moof = this.createSingleSampleMoof(sample);
      this.addBox(moof);
      moof.computeSize();
      moof.trafs[0].truns[0].data_offset = moof.size + 8;
      this.add("mdat").data = new Uint8Array(data);
      return sample;
    };
    ISOFile.prototype.createSingleSampleMoof = function(sample) {
      var sample_flags = 0;
      if (sample.is_sync)
        sample_flags = 1 << 25;
      else
        sample_flags = 1 << 16;
      var moof = new BoxParser.moofBox();
      moof.add("mfhd").set("sequence_number", this.nextMoofNumber);
      this.nextMoofNumber++;
      var traf = moof.add("traf");
      var trak = this.getTrackById(sample.track_id);
      traf.add("tfhd").set("track_id", sample.track_id).set("flags", BoxParser.TFHD_FLAG_DEFAULT_BASE_IS_MOOF);
      traf.add("tfdt").set("baseMediaDecodeTime", sample.dts - (trak.first_dts || 0));
      traf.add("trun").set("flags", BoxParser.TRUN_FLAGS_DATA_OFFSET | BoxParser.TRUN_FLAGS_DURATION | BoxParser.TRUN_FLAGS_SIZE | BoxParser.TRUN_FLAGS_FLAGS | BoxParser.TRUN_FLAGS_CTS_OFFSET).set("data_offset", 0).set("first_sample_flags", 0).set("sample_count", 1).set("sample_duration", [sample.duration]).set("sample_size", [sample.size]).set("sample_flags", [sample_flags]).set("sample_composition_time_offset", [sample.cts - sample.dts]);
      return moof;
    };
    ISOFile.prototype.lastMoofIndex = 0;
    ISOFile.prototype.samplesDataSize = 0;
    ISOFile.prototype.resetTables = function() {
      var i2;
      var trak, stco, stsc, stsz, stts, ctts, stss;
      this.initial_duration = this.moov.mvhd.duration;
      this.moov.mvhd.duration = 0;
      for (i2 = 0; i2 < this.moov.traks.length; i2++) {
        trak = this.moov.traks[i2];
        trak.tkhd.duration = 0;
        trak.mdia.mdhd.duration = 0;
        stco = trak.mdia.minf.stbl.stco || trak.mdia.minf.stbl.co64;
        stco.chunk_offsets = [];
        stsc = trak.mdia.minf.stbl.stsc;
        stsc.first_chunk = [];
        stsc.samples_per_chunk = [];
        stsc.sample_description_index = [];
        stsz = trak.mdia.minf.stbl.stsz || trak.mdia.minf.stbl.stz2;
        stsz.sample_sizes = [];
        stts = trak.mdia.minf.stbl.stts;
        stts.sample_counts = [];
        stts.sample_deltas = [];
        ctts = trak.mdia.minf.stbl.ctts;
        if (ctts) {
          ctts.sample_counts = [];
          ctts.sample_offsets = [];
        }
        stss = trak.mdia.minf.stbl.stss;
        var k2 = trak.mdia.minf.stbl.boxes.indexOf(stss);
        if (k2 != -1) trak.mdia.minf.stbl.boxes[k2] = null;
      }
    };
    ISOFile.initSampleGroups = function(trak, traf, sbgps, trak_sgpds, traf_sgpds) {
      var l2;
      var k2;
      var sample_groups_info;
      var sample_group_info;
      var sample_group_key;
      function SampleGroupInfo(_type, _parameter, _sbgp) {
        this.grouping_type = _type;
        this.grouping_type_parameter = _parameter;
        this.sbgp = _sbgp;
        this.last_sample_in_run = -1;
        this.entry_index = -1;
      }
      if (traf) {
        traf.sample_groups_info = [];
      }
      if (!trak.sample_groups_info) {
        trak.sample_groups_info = [];
      }
      for (k2 = 0; k2 < sbgps.length; k2++) {
        sample_group_key = sbgps[k2].grouping_type + "/" + sbgps[k2].grouping_type_parameter;
        sample_group_info = new SampleGroupInfo(sbgps[k2].grouping_type, sbgps[k2].grouping_type_parameter, sbgps[k2]);
        if (traf) {
          traf.sample_groups_info[sample_group_key] = sample_group_info;
        }
        if (!trak.sample_groups_info[sample_group_key]) {
          trak.sample_groups_info[sample_group_key] = sample_group_info;
        }
        for (l2 = 0; l2 < trak_sgpds.length; l2++) {
          if (trak_sgpds[l2].grouping_type === sbgps[k2].grouping_type) {
            sample_group_info.description = trak_sgpds[l2];
            sample_group_info.description.used = true;
          }
        }
        if (traf_sgpds) {
          for (l2 = 0; l2 < traf_sgpds.length; l2++) {
            if (traf_sgpds[l2].grouping_type === sbgps[k2].grouping_type) {
              sample_group_info.fragment_description = traf_sgpds[l2];
              sample_group_info.fragment_description.used = true;
              sample_group_info.is_fragment = true;
            }
          }
        }
      }
      if (!traf) {
        for (k2 = 0; k2 < trak_sgpds.length; k2++) {
          if (!trak_sgpds[k2].used && trak_sgpds[k2].version >= 2) {
            sample_group_key = trak_sgpds[k2].grouping_type + "/0";
            sample_group_info = new SampleGroupInfo(trak_sgpds[k2].grouping_type, 0);
            if (!trak.sample_groups_info[sample_group_key]) {
              trak.sample_groups_info[sample_group_key] = sample_group_info;
            }
          }
        }
      } else {
        if (traf_sgpds) {
          for (k2 = 0; k2 < traf_sgpds.length; k2++) {
            if (!traf_sgpds[k2].used && traf_sgpds[k2].version >= 2) {
              sample_group_key = traf_sgpds[k2].grouping_type + "/0";
              sample_group_info = new SampleGroupInfo(traf_sgpds[k2].grouping_type, 0);
              sample_group_info.is_fragment = true;
              if (!traf.sample_groups_info[sample_group_key]) {
                traf.sample_groups_info[sample_group_key] = sample_group_info;
              }
            }
          }
        }
      }
    };
    ISOFile.setSampleGroupProperties = function(trak, sample, sample_number, sample_groups_info) {
      var k2;
      var index;
      sample.sample_groups = [];
      for (k2 in sample_groups_info) {
        sample.sample_groups[k2] = {};
        sample.sample_groups[k2].grouping_type = sample_groups_info[k2].grouping_type;
        sample.sample_groups[k2].grouping_type_parameter = sample_groups_info[k2].grouping_type_parameter;
        if (sample_number >= sample_groups_info[k2].last_sample_in_run) {
          if (sample_groups_info[k2].last_sample_in_run < 0) {
            sample_groups_info[k2].last_sample_in_run = 0;
          }
          sample_groups_info[k2].entry_index++;
          if (sample_groups_info[k2].entry_index <= sample_groups_info[k2].sbgp.entries.length - 1) {
            sample_groups_info[k2].last_sample_in_run += sample_groups_info[k2].sbgp.entries[sample_groups_info[k2].entry_index].sample_count;
          }
        }
        if (sample_groups_info[k2].entry_index <= sample_groups_info[k2].sbgp.entries.length - 1) {
          sample.sample_groups[k2].group_description_index = sample_groups_info[k2].sbgp.entries[sample_groups_info[k2].entry_index].group_description_index;
        } else {
          sample.sample_groups[k2].group_description_index = -1;
        }
        if (sample.sample_groups[k2].group_description_index !== 0) {
          var description;
          if (sample_groups_info[k2].fragment_description) {
            description = sample_groups_info[k2].fragment_description;
          } else {
            description = sample_groups_info[k2].description;
          }
          if (sample.sample_groups[k2].group_description_index > 0) {
            if (sample.sample_groups[k2].group_description_index > 65535) {
              index = (sample.sample_groups[k2].group_description_index >> 16) - 1;
            } else {
              index = sample.sample_groups[k2].group_description_index - 1;
            }
            if (description && index >= 0) {
              sample.sample_groups[k2].description = description.entries[index];
            }
          } else {
            if (description && description.version >= 2) {
              if (description.default_group_description_index > 0) {
                sample.sample_groups[k2].description = description.entries[description.default_group_description_index - 1];
              }
            }
          }
        }
      }
    };
    ISOFile.process_sdtp = function(sdtp, sample, number) {
      if (!sample) {
        return;
      }
      if (sdtp) {
        sample.is_leading = sdtp.is_leading[number];
        sample.depends_on = sdtp.sample_depends_on[number];
        sample.is_depended_on = sdtp.sample_is_depended_on[number];
        sample.has_redundancy = sdtp.sample_has_redundancy[number];
      } else {
        sample.is_leading = 0;
        sample.depends_on = 0;
        sample.is_depended_on = 0;
        sample.has_redundancy = 0;
      }
    };
    ISOFile.prototype.buildSampleLists = function() {
      var i2;
      var trak;
      for (i2 = 0; i2 < this.moov.traks.length; i2++) {
        trak = this.moov.traks[i2];
        this.buildTrakSampleLists(trak);
      }
    };
    ISOFile.prototype.buildTrakSampleLists = function(trak) {
      var j2, k2;
      var stco, stsc, stsz, stts, ctts, stss, stsd, subs, sbgps, sgpds, stdp;
      var chunk_run_index, chunk_index, last_chunk_in_run, offset_in_chunk, last_sample_in_chunk;
      var last_sample_in_stts_run, stts_run_index, last_sample_in_ctts_run, ctts_run_index, last_stss_index, last_subs_index, subs_entry_index, last_subs_sample_index;
      trak.samples = [];
      trak.samples_duration = 0;
      trak.samples_size = 0;
      stco = trak.mdia.minf.stbl.stco || trak.mdia.minf.stbl.co64;
      stsc = trak.mdia.minf.stbl.stsc;
      stsz = trak.mdia.minf.stbl.stsz || trak.mdia.minf.stbl.stz2;
      stts = trak.mdia.minf.stbl.stts;
      ctts = trak.mdia.minf.stbl.ctts;
      stss = trak.mdia.minf.stbl.stss;
      stsd = trak.mdia.minf.stbl.stsd;
      subs = trak.mdia.minf.stbl.subs;
      stdp = trak.mdia.minf.stbl.stdp;
      sbgps = trak.mdia.minf.stbl.sbgps;
      sgpds = trak.mdia.minf.stbl.sgpds;
      last_sample_in_stts_run = -1;
      stts_run_index = -1;
      last_sample_in_ctts_run = -1;
      ctts_run_index = -1;
      last_stss_index = 0;
      subs_entry_index = 0;
      last_subs_sample_index = 0;
      ISOFile.initSampleGroups(trak, null, sbgps, sgpds);
      if (typeof stsz === "undefined") {
        return;
      }
      for (j2 = 0; j2 < stsz.sample_sizes.length; j2++) {
        var sample = {};
        sample.number = j2;
        sample.track_id = trak.tkhd.track_id;
        sample.timescale = trak.mdia.mdhd.timescale;
        sample.alreadyRead = 0;
        trak.samples[j2] = sample;
        sample.size = stsz.sample_sizes[j2];
        trak.samples_size += sample.size;
        if (j2 === 0) {
          chunk_index = 1;
          chunk_run_index = 0;
          sample.chunk_index = chunk_index;
          sample.chunk_run_index = chunk_run_index;
          last_sample_in_chunk = stsc.samples_per_chunk[chunk_run_index];
          offset_in_chunk = 0;
          if (chunk_run_index + 1 < stsc.first_chunk.length) {
            last_chunk_in_run = stsc.first_chunk[chunk_run_index + 1] - 1;
          } else {
            last_chunk_in_run = Infinity;
          }
        } else {
          if (j2 < last_sample_in_chunk) {
            sample.chunk_index = chunk_index;
            sample.chunk_run_index = chunk_run_index;
          } else {
            chunk_index++;
            sample.chunk_index = chunk_index;
            offset_in_chunk = 0;
            if (chunk_index <= last_chunk_in_run) {
            } else {
              chunk_run_index++;
              if (chunk_run_index + 1 < stsc.first_chunk.length) {
                last_chunk_in_run = stsc.first_chunk[chunk_run_index + 1] - 1;
              } else {
                last_chunk_in_run = Infinity;
              }
            }
            sample.chunk_run_index = chunk_run_index;
            last_sample_in_chunk += stsc.samples_per_chunk[chunk_run_index];
          }
        }
        sample.description_index = stsc.sample_description_index[sample.chunk_run_index] - 1;
        sample.description = stsd.entries[sample.description_index];
        sample.offset = stco.chunk_offsets[sample.chunk_index - 1] + offset_in_chunk;
        offset_in_chunk += sample.size;
        if (j2 > last_sample_in_stts_run) {
          stts_run_index++;
          if (last_sample_in_stts_run < 0) {
            last_sample_in_stts_run = 0;
          }
          last_sample_in_stts_run += stts.sample_counts[stts_run_index];
        }
        if (j2 > 0) {
          trak.samples[j2 - 1].duration = stts.sample_deltas[stts_run_index];
          trak.samples_duration += trak.samples[j2 - 1].duration;
          sample.dts = trak.samples[j2 - 1].dts + trak.samples[j2 - 1].duration;
        } else {
          sample.dts = 0;
        }
        if (ctts) {
          if (j2 >= last_sample_in_ctts_run) {
            ctts_run_index++;
            if (last_sample_in_ctts_run < 0) {
              last_sample_in_ctts_run = 0;
            }
            last_sample_in_ctts_run += ctts.sample_counts[ctts_run_index];
          }
          sample.cts = trak.samples[j2].dts + ctts.sample_offsets[ctts_run_index];
        } else {
          sample.cts = sample.dts;
        }
        if (stss) {
          if (j2 == stss.sample_numbers[last_stss_index] - 1) {
            sample.is_sync = true;
            last_stss_index++;
          } else {
            sample.is_sync = false;
            sample.degradation_priority = 0;
          }
          if (subs) {
            if (subs.entries[subs_entry_index].sample_delta + last_subs_sample_index == j2 + 1) {
              sample.subsamples = subs.entries[subs_entry_index].subsamples;
              last_subs_sample_index += subs.entries[subs_entry_index].sample_delta;
              subs_entry_index++;
            }
          }
        } else {
          sample.is_sync = true;
        }
        ISOFile.process_sdtp(trak.mdia.minf.stbl.sdtp, sample, sample.number);
        if (stdp) {
          sample.degradation_priority = stdp.priority[j2];
        } else {
          sample.degradation_priority = 0;
        }
        if (subs) {
          if (subs.entries[subs_entry_index].sample_delta + last_subs_sample_index == j2) {
            sample.subsamples = subs.entries[subs_entry_index].subsamples;
            last_subs_sample_index += subs.entries[subs_entry_index].sample_delta;
          }
        }
        if (sbgps.length > 0 || sgpds.length > 0) {
          ISOFile.setSampleGroupProperties(trak, sample, j2, trak.sample_groups_info);
        }
      }
      if (j2 > 0) {
        trak.samples[j2 - 1].duration = Math.max(trak.mdia.mdhd.duration - trak.samples[j2 - 1].dts, 0);
        trak.samples_duration += trak.samples[j2 - 1].duration;
      }
    };
    ISOFile.prototype.updateSampleLists = function() {
      var i2, j2, k2;
      var default_sample_description_index, default_sample_duration, default_sample_size, default_sample_flags;
      var last_run_position;
      var box2, moof, traf, trak, trex;
      var sample;
      var sample_flags;
      if (this.moov === void 0) {
        return;
      }
      while (this.lastMoofIndex < this.moofs.length) {
        box2 = this.moofs[this.lastMoofIndex];
        this.lastMoofIndex++;
        if (box2.type == "moof") {
          moof = box2;
          for (i2 = 0; i2 < moof.trafs.length; i2++) {
            traf = moof.trafs[i2];
            trak = this.getTrackById(traf.tfhd.track_id);
            if (trak.samples == null) trak.samples = [];
            trex = this.getTrexById(traf.tfhd.track_id);
            if (traf.tfhd.flags & BoxParser.TFHD_FLAG_SAMPLE_DESC) {
              default_sample_description_index = traf.tfhd.default_sample_description_index;
            } else {
              default_sample_description_index = trex ? trex.default_sample_description_index : 1;
            }
            if (traf.tfhd.flags & BoxParser.TFHD_FLAG_SAMPLE_DUR) {
              default_sample_duration = traf.tfhd.default_sample_duration;
            } else {
              default_sample_duration = trex ? trex.default_sample_duration : 0;
            }
            if (traf.tfhd.flags & BoxParser.TFHD_FLAG_SAMPLE_SIZE) {
              default_sample_size = traf.tfhd.default_sample_size;
            } else {
              default_sample_size = trex ? trex.default_sample_size : 0;
            }
            if (traf.tfhd.flags & BoxParser.TFHD_FLAG_SAMPLE_FLAGS) {
              default_sample_flags = traf.tfhd.default_sample_flags;
            } else {
              default_sample_flags = trex ? trex.default_sample_flags : 0;
            }
            traf.sample_number = 0;
            if (traf.sbgps.length > 0) {
              ISOFile.initSampleGroups(trak, traf, traf.sbgps, trak.mdia.minf.stbl.sgpds, traf.sgpds);
            }
            for (j2 = 0; j2 < traf.truns.length; j2++) {
              var trun = traf.truns[j2];
              for (k2 = 0; k2 < trun.sample_count; k2++) {
                sample = {};
                sample.moof_number = this.lastMoofIndex;
                sample.number_in_traf = traf.sample_number;
                traf.sample_number++;
                sample.number = trak.samples.length;
                traf.first_sample_index = trak.samples.length;
                trak.samples.push(sample);
                sample.track_id = trak.tkhd.track_id;
                sample.timescale = trak.mdia.mdhd.timescale;
                sample.description_index = default_sample_description_index - 1;
                sample.description = trak.mdia.minf.stbl.stsd.entries[sample.description_index];
                sample.size = default_sample_size;
                if (trun.flags & BoxParser.TRUN_FLAGS_SIZE) {
                  sample.size = trun.sample_size[k2];
                }
                trak.samples_size += sample.size;
                sample.duration = default_sample_duration;
                if (trun.flags & BoxParser.TRUN_FLAGS_DURATION) {
                  sample.duration = trun.sample_duration[k2];
                }
                trak.samples_duration += sample.duration;
                if (trak.first_traf_merged || k2 > 0) {
                  sample.dts = trak.samples[trak.samples.length - 2].dts + trak.samples[trak.samples.length - 2].duration;
                } else {
                  if (traf.tfdt) {
                    sample.dts = traf.tfdt.baseMediaDecodeTime;
                  } else {
                    sample.dts = 0;
                  }
                  trak.first_traf_merged = true;
                }
                sample.cts = sample.dts;
                if (trun.flags & BoxParser.TRUN_FLAGS_CTS_OFFSET) {
                  sample.cts = sample.dts + trun.sample_composition_time_offset[k2];
                }
                sample_flags = default_sample_flags;
                if (trun.flags & BoxParser.TRUN_FLAGS_FLAGS) {
                  sample_flags = trun.sample_flags[k2];
                } else if (k2 === 0 && trun.flags & BoxParser.TRUN_FLAGS_FIRST_FLAG) {
                  sample_flags = trun.first_sample_flags;
                }
                sample.is_sync = sample_flags >> 16 & 1 ? false : true;
                sample.is_leading = sample_flags >> 26 & 3;
                sample.depends_on = sample_flags >> 24 & 3;
                sample.is_depended_on = sample_flags >> 22 & 3;
                sample.has_redundancy = sample_flags >> 20 & 3;
                sample.degradation_priority = sample_flags & 65535;
                var bdop = traf.tfhd.flags & BoxParser.TFHD_FLAG_BASE_DATA_OFFSET ? true : false;
                var dbim = traf.tfhd.flags & BoxParser.TFHD_FLAG_DEFAULT_BASE_IS_MOOF ? true : false;
                var dop = trun.flags & BoxParser.TRUN_FLAGS_DATA_OFFSET ? true : false;
                var bdo = 0;
                if (!bdop) {
                  if (!dbim) {
                    if (j2 === 0) {
                      bdo = moof.start;
                    } else {
                      bdo = last_run_position;
                    }
                  } else {
                    bdo = moof.start;
                  }
                } else {
                  bdo = traf.tfhd.base_data_offset;
                }
                if (j2 === 0 && k2 === 0) {
                  if (dop) {
                    sample.offset = bdo + trun.data_offset;
                  } else {
                    sample.offset = bdo;
                  }
                } else {
                  sample.offset = last_run_position;
                }
                last_run_position = sample.offset + sample.size;
                if (traf.sbgps.length > 0 || traf.sgpds.length > 0 || trak.mdia.minf.stbl.sbgps.length > 0 || trak.mdia.minf.stbl.sgpds.length > 0) {
                  ISOFile.setSampleGroupProperties(trak, sample, sample.number_in_traf, traf.sample_groups_info);
                }
              }
            }
            if (traf.subs) {
              trak.has_fragment_subsamples = true;
              var sample_index = traf.first_sample_index;
              for (j2 = 0; j2 < traf.subs.entries.length; j2++) {
                sample_index += traf.subs.entries[j2].sample_delta;
                sample = trak.samples[sample_index - 1];
                sample.subsamples = traf.subs.entries[j2].subsamples;
              }
            }
          }
        }
      }
    };
    ISOFile.prototype.getSample = function(trak, sampleNum) {
      var buffer;
      var sample = trak.samples[sampleNum];
      if (!this.moov) {
        return null;
      }
      if (!sample.data) {
        sample.data = new Uint8Array(sample.size);
        sample.alreadyRead = 0;
        this.samplesDataSize += sample.size;
        Log.debug("ISOFile", "Allocating sample #" + sampleNum + " on track #" + trak.tkhd.track_id + " of size " + sample.size + " (total: " + this.samplesDataSize + ")");
      } else if (sample.alreadyRead == sample.size) {
        return sample;
      }
      while (true) {
        var index = this.stream.findPosition(true, sample.offset + sample.alreadyRead, false);
        if (index > -1) {
          buffer = this.stream.buffers[index];
          var lengthAfterStart = buffer.byteLength - (sample.offset + sample.alreadyRead - buffer.fileStart);
          if (sample.size - sample.alreadyRead <= lengthAfterStart) {
            Log.debug("ISOFile", "Getting sample #" + sampleNum + " data (alreadyRead: " + sample.alreadyRead + " offset: " + (sample.offset + sample.alreadyRead - buffer.fileStart) + " read size: " + (sample.size - sample.alreadyRead) + " full size: " + sample.size + ")");
            DataStream.memcpy(
              sample.data.buffer,
              sample.alreadyRead,
              buffer,
              sample.offset + sample.alreadyRead - buffer.fileStart,
              sample.size - sample.alreadyRead
            );
            buffer.usedBytes += sample.size - sample.alreadyRead;
            this.stream.logBufferLevel();
            sample.alreadyRead = sample.size;
            return sample;
          } else {
            if (lengthAfterStart === 0) return null;
            Log.debug("ISOFile", "Getting sample #" + sampleNum + " partial data (alreadyRead: " + sample.alreadyRead + " offset: " + (sample.offset + sample.alreadyRead - buffer.fileStart) + " read size: " + lengthAfterStart + " full size: " + sample.size + ")");
            DataStream.memcpy(
              sample.data.buffer,
              sample.alreadyRead,
              buffer,
              sample.offset + sample.alreadyRead - buffer.fileStart,
              lengthAfterStart
            );
            sample.alreadyRead += lengthAfterStart;
            buffer.usedBytes += lengthAfterStart;
            this.stream.logBufferLevel();
          }
        } else {
          return null;
        }
      }
    };
    ISOFile.prototype.releaseSample = function(trak, sampleNum) {
      var sample = trak.samples[sampleNum];
      if (sample.data) {
        this.samplesDataSize -= sample.size;
        sample.data = null;
        sample.alreadyRead = 0;
        return sample.size;
      } else {
        return 0;
      }
    };
    ISOFile.prototype.getAllocatedSampleDataSize = function() {
      return this.samplesDataSize;
    };
    ISOFile.prototype.getCodecs = function() {
      var i2;
      var codecs = "";
      for (i2 = 0; i2 < this.moov.traks.length; i2++) {
        var trak = this.moov.traks[i2];
        if (i2 > 0) {
          codecs += ",";
        }
        codecs += trak.mdia.minf.stbl.stsd.entries[0].getCodec();
      }
      return codecs;
    };
    ISOFile.prototype.getTrexById = function(id) {
      var i2;
      if (!this.moov || !this.moov.mvex) return null;
      for (i2 = 0; i2 < this.moov.mvex.trexs.length; i2++) {
        var trex = this.moov.mvex.trexs[i2];
        if (trex.track_id == id) return trex;
      }
      return null;
    };
    ISOFile.prototype.getTrackById = function(id) {
      if (this.moov === void 0) {
        return null;
      }
      for (var j2 = 0; j2 < this.moov.traks.length; j2++) {
        var trak = this.moov.traks[j2];
        if (trak.tkhd.track_id == id) return trak;
      }
      return null;
    };
    ISOFile.prototype.items = [];
    ISOFile.prototype.entity_groups = [];
    ISOFile.prototype.itemsDataSize = 0;
    ISOFile.prototype.flattenItemInfo = function() {
      var items = this.items;
      var entity_groups = this.entity_groups;
      var i2, j2;
      var item;
      var meta = this.meta;
      if (meta === null || meta === void 0) return;
      if (meta.hdlr === void 0) return;
      if (meta.iinf === void 0) return;
      for (i2 = 0; i2 < meta.iinf.item_infos.length; i2++) {
        item = {};
        item.id = meta.iinf.item_infos[i2].item_ID;
        items[item.id] = item;
        item.ref_to = [];
        item.name = meta.iinf.item_infos[i2].item_name;
        if (meta.iinf.item_infos[i2].protection_index > 0) {
          item.protection = meta.ipro.protections[meta.iinf.item_infos[i2].protection_index - 1];
        }
        if (meta.iinf.item_infos[i2].item_type) {
          item.type = meta.iinf.item_infos[i2].item_type;
        } else {
          item.type = "mime";
        }
        item.content_type = meta.iinf.item_infos[i2].content_type;
        item.content_encoding = meta.iinf.item_infos[i2].content_encoding;
      }
      if (meta.grpl) {
        for (i2 = 0; i2 < meta.grpl.boxes.length; i2++) {
          entity_group = {};
          entity_group.id = meta.grpl.boxes[i2].group_id;
          entity_group.entity_ids = meta.grpl.boxes[i2].entity_ids;
          entity_group.type = meta.grpl.boxes[i2].type;
          entity_groups[entity_group.id] = entity_group;
        }
      }
      if (meta.iloc) {
        for (i2 = 0; i2 < meta.iloc.items.length; i2++) {
          var offset;
          var itemloc = meta.iloc.items[i2];
          item = items[itemloc.item_ID];
          if (itemloc.data_reference_index !== 0) {
            Log.warn("Item storage with reference to other files: not supported");
            item.source = meta.dinf.boxes[itemloc.data_reference_index - 1];
          }
          switch (itemloc.construction_method) {
            case 0:
              break;
            case 1:
              Log.warn("Item storage with construction_method : not supported");
              break;
            case 2:
              Log.warn("Item storage with construction_method : not supported");
              break;
          }
          item.extents = [];
          item.size = 0;
          for (j2 = 0; j2 < itemloc.extents.length; j2++) {
            item.extents[j2] = {};
            item.extents[j2].offset = itemloc.extents[j2].extent_offset + itemloc.base_offset;
            item.extents[j2].length = itemloc.extents[j2].extent_length;
            item.extents[j2].alreadyRead = 0;
            item.size += item.extents[j2].length;
          }
        }
      }
      if (meta.pitm) {
        items[meta.pitm.item_id].primary = true;
      }
      if (meta.iref) {
        for (i2 = 0; i2 < meta.iref.references.length; i2++) {
          var ref = meta.iref.references[i2];
          for (j2 = 0; j2 < ref.references.length; j2++) {
            items[ref.from_item_ID].ref_to.push({ type: ref.type, id: ref.references[j2] });
          }
        }
      }
      if (meta.iprp) {
        for (var k2 = 0; k2 < meta.iprp.ipmas.length; k2++) {
          var ipma = meta.iprp.ipmas[k2];
          for (i2 = 0; i2 < ipma.associations.length; i2++) {
            var association = ipma.associations[i2];
            item = items[association.id];
            if (!item) {
              item = entity_groups[association.id];
            }
            if (item) {
              if (item.properties === void 0) {
                item.properties = {};
                item.properties.boxes = [];
              }
              for (j2 = 0; j2 < association.props.length; j2++) {
                var propEntry = association.props[j2];
                if (propEntry.property_index > 0 && propEntry.property_index - 1 < meta.iprp.ipco.boxes.length) {
                  var propbox = meta.iprp.ipco.boxes[propEntry.property_index - 1];
                  item.properties[propbox.type] = propbox;
                  item.properties.boxes.push(propbox);
                }
              }
            }
          }
        }
      }
    };
    ISOFile.prototype.getItem = function(item_id) {
      var buffer;
      var item;
      if (!this.meta) {
        return null;
      }
      item = this.items[item_id];
      if (!item.data && item.size) {
        item.data = new Uint8Array(item.size);
        item.alreadyRead = 0;
        this.itemsDataSize += item.size;
        Log.debug("ISOFile", "Allocating item #" + item_id + " of size " + item.size + " (total: " + this.itemsDataSize + ")");
      } else if (item.alreadyRead === item.size) {
        return item;
      }
      for (var i2 = 0; i2 < item.extents.length; i2++) {
        var extent = item.extents[i2];
        if (extent.alreadyRead === extent.length) {
          continue;
        } else {
          var index = this.stream.findPosition(true, extent.offset + extent.alreadyRead, false);
          if (index > -1) {
            buffer = this.stream.buffers[index];
            var lengthAfterStart = buffer.byteLength - (extent.offset + extent.alreadyRead - buffer.fileStart);
            if (extent.length - extent.alreadyRead <= lengthAfterStart) {
              Log.debug("ISOFile", "Getting item #" + item_id + " extent #" + i2 + " data (alreadyRead: " + extent.alreadyRead + " offset: " + (extent.offset + extent.alreadyRead - buffer.fileStart) + " read size: " + (extent.length - extent.alreadyRead) + " full extent size: " + extent.length + " full item size: " + item.size + ")");
              DataStream.memcpy(
                item.data.buffer,
                item.alreadyRead,
                buffer,
                extent.offset + extent.alreadyRead - buffer.fileStart,
                extent.length - extent.alreadyRead
              );
              buffer.usedBytes += extent.length - extent.alreadyRead;
              this.stream.logBufferLevel();
              item.alreadyRead += extent.length - extent.alreadyRead;
              extent.alreadyRead = extent.length;
            } else {
              Log.debug("ISOFile", "Getting item #" + item_id + " extent #" + i2 + " partial data (alreadyRead: " + extent.alreadyRead + " offset: " + (extent.offset + extent.alreadyRead - buffer.fileStart) + " read size: " + lengthAfterStart + " full extent size: " + extent.length + " full item size: " + item.size + ")");
              DataStream.memcpy(
                item.data.buffer,
                item.alreadyRead,
                buffer,
                extent.offset + extent.alreadyRead - buffer.fileStart,
                lengthAfterStart
              );
              extent.alreadyRead += lengthAfterStart;
              item.alreadyRead += lengthAfterStart;
              buffer.usedBytes += lengthAfterStart;
              this.stream.logBufferLevel();
              return null;
            }
          } else {
            return null;
          }
        }
      }
      if (item.alreadyRead === item.size) {
        return item;
      } else {
        return null;
      }
    };
    ISOFile.prototype.releaseItem = function(item_id) {
      var item = this.items[item_id];
      if (item.data) {
        this.itemsDataSize -= item.size;
        item.data = null;
        item.alreadyRead = 0;
        for (var i2 = 0; i2 < item.extents.length; i2++) {
          var extent = item.extents[i2];
          extent.alreadyRead = 0;
        }
        return item.size;
      } else {
        return 0;
      }
    };
    ISOFile.prototype.processItems = function(callback) {
      for (var i2 in this.items) {
        var item = this.items[i2];
        this.getItem(item.id);
        if (callback && !item.sent) {
          callback(item);
          item.sent = true;
          item.data = null;
        }
      }
    };
    ISOFile.prototype.hasItem = function(name) {
      for (var i2 in this.items) {
        var item = this.items[i2];
        if (item.name === name) {
          return item.id;
        }
      }
      return -1;
    };
    ISOFile.prototype.getMetaHandler = function() {
      if (!this.meta) {
        return null;
      } else {
        return this.meta.hdlr.handler;
      }
    };
    ISOFile.prototype.getPrimaryItem = function() {
      if (!this.meta || !this.meta.pitm) {
        return null;
      } else {
        return this.getItem(this.meta.pitm.item_id);
      }
    };
    ISOFile.prototype.itemToFragmentedTrackFile = function(_options) {
      var options = _options || {};
      var item = null;
      if (options.itemId) {
        item = this.getItem(options.itemId);
      } else {
        item = this.getPrimaryItem();
      }
      if (item == null) return null;
      var file = new ISOFile();
      file.discardMdatData = false;
      var trackOptions = { type: item.type, description_boxes: item.properties.boxes };
      if (item.properties.ispe) {
        trackOptions.width = item.properties.ispe.image_width;
        trackOptions.height = item.properties.ispe.image_height;
      }
      var trackId = file.addTrack(trackOptions);
      if (trackId) {
        file.addSample(trackId, item.data);
        return file;
      } else {
        return null;
      }
    };
    ISOFile.prototype.write = function(outstream) {
      for (var i2 = 0; i2 < this.boxes.length; i2++) {
        this.boxes[i2].write(outstream);
      }
    };
    ISOFile.prototype.createFragment = function(track_id, sampleNumber, stream_) {
      var trak = this.getTrackById(track_id);
      var sample = this.getSample(trak, sampleNumber);
      if (sample == null) {
        this.setNextSeekPositionFromSample(trak.samples[sampleNumber]);
        return null;
      }
      var stream = stream_ || new DataStream();
      stream.endianness = DataStream.BIG_ENDIAN;
      var moof = this.createSingleSampleMoof(sample);
      moof.write(stream);
      moof.trafs[0].truns[0].data_offset = moof.size + 8;
      Log.debug("MP4Box", "Adjusting data_offset with new value " + moof.trafs[0].truns[0].data_offset);
      stream.adjustUint32(moof.trafs[0].truns[0].data_offset_position, moof.trafs[0].truns[0].data_offset);
      var mdat = new BoxParser.mdatBox();
      mdat.data = sample.data;
      mdat.write(stream);
      return stream;
    };
    ISOFile.writeInitializationSegment = function(ftyp, moov, total_duration, sample_duration) {
      var i2;
      var index;
      var mehd;
      var trex;
      var box2;
      Log.debug("ISOFile", "Generating initialization segment");
      var stream = new DataStream();
      stream.endianness = DataStream.BIG_ENDIAN;
      ftyp.write(stream);
      var mvex = moov.add("mvex");
      if (total_duration) {
        mvex.add("mehd").set("fragment_duration", total_duration);
      }
      for (i2 = 0; i2 < moov.traks.length; i2++) {
        mvex.add("trex").set("track_id", moov.traks[i2].tkhd.track_id).set("default_sample_description_index", 1).set("default_sample_duration", sample_duration).set("default_sample_size", 0).set("default_sample_flags", 1 << 16);
      }
      moov.write(stream);
      return stream.buffer;
    };
    ISOFile.prototype.save = function(name) {
      var stream = new DataStream();
      stream.endianness = DataStream.BIG_ENDIAN;
      this.write(stream);
      stream.save(name);
    };
    ISOFile.prototype.getBuffer = function() {
      var stream = new DataStream();
      stream.endianness = DataStream.BIG_ENDIAN;
      this.write(stream);
      return stream.buffer;
    };
    ISOFile.prototype.initializeSegmentation = function() {
      var i2;
      var j2;
      var box2;
      var initSegs;
      var trak;
      var seg;
      if (this.onSegment === null) {
        Log.warn("MP4Box", "No segmentation callback set!");
      }
      if (!this.isFragmentationInitialized) {
        this.isFragmentationInitialized = true;
        this.nextMoofNumber = 0;
        this.resetTables();
      }
      initSegs = [];
      for (i2 = 0; i2 < this.fragmentedTracks.length; i2++) {
        var moov = new BoxParser.moovBox();
        moov.mvhd = this.moov.mvhd;
        moov.boxes.push(moov.mvhd);
        trak = this.getTrackById(this.fragmentedTracks[i2].id);
        moov.boxes.push(trak);
        moov.traks.push(trak);
        seg = {};
        seg.id = trak.tkhd.track_id;
        seg.user = this.fragmentedTracks[i2].user;
        seg.buffer = ISOFile.writeInitializationSegment(this.ftyp, moov, this.moov.mvex && this.moov.mvex.mehd ? this.moov.mvex.mehd.fragment_duration : void 0, this.moov.traks[i2].samples.length > 0 ? this.moov.traks[i2].samples[0].duration : 0);
        initSegs.push(seg);
      }
      return initSegs;
    };
    BoxParser.Box.prototype.printHeader = function(output) {
      this.size += 8;
      if (this.size > MAX_SIZE) {
        this.size += 8;
      }
      if (this.type === "uuid") {
        this.size += 16;
      }
      output.log(output.indent + "size:" + this.size);
      output.log(output.indent + "type:" + this.type);
    };
    BoxParser.FullBox.prototype.printHeader = function(output) {
      this.size += 4;
      BoxParser.Box.prototype.printHeader.call(this, output);
      output.log(output.indent + "version:" + this.version);
      output.log(output.indent + "flags:" + this.flags);
    };
    BoxParser.Box.prototype.print = function(output) {
      this.printHeader(output);
    };
    BoxParser.ContainerBox.prototype.print = function(output) {
      this.printHeader(output);
      for (var i2 = 0; i2 < this.boxes.length; i2++) {
        if (this.boxes[i2]) {
          var prev_indent = output.indent;
          output.indent += " ";
          this.boxes[i2].print(output);
          output.indent = prev_indent;
        }
      }
    };
    ISOFile.prototype.print = function(output) {
      output.indent = "";
      for (var i2 = 0; i2 < this.boxes.length; i2++) {
        if (this.boxes[i2]) {
          this.boxes[i2].print(output);
        }
      }
    };
    BoxParser.mvhdBox.prototype.print = function(output) {
      BoxParser.FullBox.prototype.printHeader.call(this, output);
      output.log(output.indent + "creation_time: " + this.creation_time);
      output.log(output.indent + "modification_time: " + this.modification_time);
      output.log(output.indent + "timescale: " + this.timescale);
      output.log(output.indent + "duration: " + this.duration);
      output.log(output.indent + "rate: " + this.rate);
      output.log(output.indent + "volume: " + (this.volume >> 8));
      output.log(output.indent + "matrix: " + this.matrix.join(", "));
      output.log(output.indent + "next_track_id: " + this.next_track_id);
    };
    BoxParser.tkhdBox.prototype.print = function(output) {
      BoxParser.FullBox.prototype.printHeader.call(this, output);
      output.log(output.indent + "creation_time: " + this.creation_time);
      output.log(output.indent + "modification_time: " + this.modification_time);
      output.log(output.indent + "track_id: " + this.track_id);
      output.log(output.indent + "duration: " + this.duration);
      output.log(output.indent + "volume: " + (this.volume >> 8));
      output.log(output.indent + "matrix: " + this.matrix.join(", "));
      output.log(output.indent + "layer: " + this.layer);
      output.log(output.indent + "alternate_group: " + this.alternate_group);
      output.log(output.indent + "width: " + this.width);
      output.log(output.indent + "height: " + this.height);
    };
    var MP4Box2 = {};
    MP4Box2.createFile = function(_keepMdatData, _stream) {
      var keepMdatData = _keepMdatData !== void 0 ? _keepMdatData : true;
      var file = new ISOFile(_stream);
      file.discardMdatData = keepMdatData ? false : true;
      return file;
    };
    if (typeof exports !== "undefined") {
      exports.createFile = MP4Box2.createFile;
    }
  }
});

// ../preview-engine/src/eventEmitter.ts
var TypedEmitter = class {
  listeners = {};
  on(event, cb) {
    if (!this.listeners[event]) this.listeners[event] = /* @__PURE__ */ new Set();
    this.listeners[event].add(cb);
    return () => this.off(event, cb);
  }
  off(event, cb) {
    this.listeners[event]?.delete(cb);
  }
  emit(event, payload) {
    const set = this.listeners[event];
    if (!set) return;
    for (const cb of [...set]) {
      try {
        cb(payload);
      } catch (e) {
        console.error("[preview-engine] listener error", event, e);
      }
    }
  }
  removeAll() {
    this.listeners = {};
  }
};

// ../preview-engine/src/timeline.ts
var Timeline = class {
  fps;
  clips;
  constructor(spec) {
    this.fps = spec.fps;
    this.clips = [...spec.clips].sort((a, b) => a.startFrame - b.startFrame);
  }
  getClips() {
    return this.clips;
  }
  totalFrames() {
    return this.clips.reduce((max, c) => Math.max(max, c.endFrame), 0);
  }
  resolve(frame) {
    const primary = this.clips.find(
      (c) => frame >= c.startFrame && frame < c.endFrame && (c.track ?? 0) === this.primaryTrack()
    );
    if (!primary) return null;
    const localFrame = frame - primary.startFrame;
    const sourceInUs = primary.sourceInUs ?? 0;
    const sourceTimeUs = sourceInUs + localFrame / this.fps * 1e6;
    const activeLayerCount = this.clips.filter(
      (c) => frame >= c.startFrame && frame < c.endFrame && (c.mediaType ?? "video") !== void 0 && ((c.mediaType ?? "video") === "video" || (c.mediaType ?? "video") === "image")
    ).length;
    const nextClip = this.clips.filter((c) => c.track === primary.track && c.startFrame >= primary.endFrame).sort((a, b) => a.startFrame - b.startFrame)[0] ?? null;
    const boundaryFrame = primary.endFrame;
    const framesToBoundary = boundaryFrame - frame;
    const secondsToBoundary = nextClip && nextClip.startFrame === primary.endFrame ? framesToBoundary / this.fps : null;
    return {
      clip: primary,
      localFrame,
      sourceTimeUs,
      activeLayerCount: Math.max(1, activeLayerCount),
      nextClip,
      secondsToBoundary
    };
  }
  primaryTrack() {
    return this.clips.reduce((min, c) => Math.min(min, c.track ?? 0), Infinity);
  }
};

// ../../node_modules/@webav/av-cliper/dist/av-cliper.js
var import_mp4box2 = __toESM(require_mp4box_all(), 1);

// ../../node_modules/@webav/internal-utils/dist/internal-utils.js
var import_mp4box = __toESM(require_mp4box_all(), 1);
var L = () => {
  let e, t = 16.6;
  self.onmessage = (n2) => {
    n2.data.event === "start" && (self.clearInterval(e), e = self.setInterval(() => {
      self.postMessage({});
    }, t)), n2.data.event === "stop" && self.clearInterval(e);
  };
};
var V = () => {
  const e = new Blob([`(${L.toString()})()`]), t = URL.createObjectURL(e);
  return new Worker(t);
};
var E = /* @__PURE__ */ new Map();
var B = 1;
var z = null;
globalThis.Worker != null && (z = V(), z.onmessage = () => {
  B += 1;
  for (const [e, t] of E)
    if (B % e === 0) for (const n2 of t) n2();
});
var _ = (e, t) => {
  const n2 = Math.round(t / 16.6), r = E.get(n2) ?? /* @__PURE__ */ new Set();
  return r.add(e), E.set(n2, r), E.size === 1 && r.size === 1 && z?.postMessage({ event: "start" }), () => {
    r.delete(e), r.size === 0 && E.delete(n2), E.size === 0 && (B = 0, z?.postMessage({ event: "stop" }));
  };
};
function F(e) {
  return e instanceof Error ? String(e) : typeof e == "object" ? JSON.stringify(e, (t, n2) => n2 instanceof Error ? String(n2) : n2) : String(e);
}
function O() {
  const e = /* @__PURE__ */ new Date();
  return `${e.getHours()}:${e.getMinutes()}:${e.getSeconds()}.${e.getMilliseconds()}`;
}
var C = 1;
var $ = [];
var U = ["debug", "info", "warn", "error"].reduce(
  (e, t, n2) => Object.assign(e, {
    [t]: (...r) => {
      C <= n2 && (console[t](...r), $.push({
        lvName: t,
        timeStr: O(),
        args: r
      }));
    }
  }),
  {}
);
var A = /* @__PURE__ */ new Map();
var S = {
  /**
   * 设置记录日志的级别
   *
   * @example
   * Log.setLogLevel(Log.warn) // 记录 warn，error 日志
   */
  setLogLevel: (e) => {
    C = A.get(e) ?? 1;
  },
  ...U,
  /**
   * 生成一个 log 实例，所有输出前都会附加 tag
   *
   * @example
   * const log = Log.create('<prefix>')
   * log.info('xxx') // '<prefix> xxx'
   */
  create: (e) => Object.fromEntries(
    Object.entries(U).map(([t, n2]) => [
      t,
      (...r) => n2(e, ...r)
    ])
  ),
  /**
   * 将所有日志导出为一个字符串
   *
   * @example
   * Log.dump() // => [level][time]  内容...
   *
   */
  async dump() {
    return $.reduce(
      (e, { lvName: t, timeStr: n2, args: r }) => e + `[${t}][${n2}]  ${r.map((o2) => F(o2)).join(" ")}
`,
      ""
    );
  }
};
A.set(S.debug, 0);
A.set(S.info, 1);
A.set(S.warn, 2);
A.set(S.error, 3);
(async function() {
  if (await Promise.resolve(), !(globalThis.navigator == null || globalThis.document == null) && (S.info(
    `@webav version: 1.2.8, date: ${(/* @__PURE__ */ new Date()).toLocaleDateString()}`
  ), S.info(globalThis.navigator.userAgent), document.addEventListener("visibilitychange", () => {
    S.info(`visibilitychange: ${document.visibilityState}`);
  }), "PressureObserver" in globalThis)) {
    let t = "";
    new PressureObserver((r) => {
      const o2 = JSON.stringify(r.map((s) => s.state));
      o2 !== t && (S.info(`cpu state change: ${o2}`), t = o2);
    }).observe("cpu");
  }
})();

// ../../node_modules/wave-resampler/lib/interpolator.js
var Interpolator = class {
  /**
   * @param {number} scaleFrom the length of the original array.
   * @param {number} scaleTo The length of the new array.
   * @param {?Object} details The extra configuration, if needed.
   */
  constructor(scaleFrom, scaleTo, details) {
    this.length_ = scaleFrom;
    this.scaleFactor_ = (scaleFrom - 1) / scaleTo;
    this.interpolate = this.cubic;
    if (details.method === "point") {
      this.interpolate = this.point;
    } else if (details.method === "linear") {
      this.interpolate = this.linear;
    } else if (details.method === "sinc") {
      this.interpolate = this.sinc;
    }
    this.tangentFactor_ = 1 - Math.max(0, Math.min(1, details.tension || 0));
    this.sincFilterSize_ = details.sincFilterSize || 1;
    this.kernel_ = sincKernel_(details.sincWindow || window_);
  }
  /**
   * @param {number} t The index to interpolate.
   * @param {Array|TypedArray} samples the original array.
   * @return {number} The interpolated value.
   */
  point(t, samples) {
    return this.getClippedInput_(Math.round(this.scaleFactor_ * t), samples);
  }
  /**
   * @param {number} t The index to interpolate.
   * @param {Array|TypedArray} samples the original array.
   * @return {number} The interpolated value.
   */
  linear(t, samples) {
    t = this.scaleFactor_ * t;
    let k2 = Math.floor(t);
    t -= k2;
    return (1 - t) * this.getClippedInput_(k2, samples) + t * this.getClippedInput_(k2 + 1, samples);
  }
  /**
   * @param {number} t The index to interpolate.
   * @param {Array|TypedArray} samples the original array.
   * @return {number} The interpolated value.
   */
  cubic(t, samples) {
    t = this.scaleFactor_ * t;
    let k2 = Math.floor(t);
    let m2 = [this.getTangent_(k2, samples), this.getTangent_(k2 + 1, samples)];
    let p2 = [
      this.getClippedInput_(k2, samples),
      this.getClippedInput_(k2 + 1, samples)
    ];
    t -= k2;
    let t2 = t * t;
    let t3 = t * t2;
    return (2 * t3 - 3 * t2 + 1) * p2[0] + (t3 - 2 * t2 + t) * m2[0] + (-2 * t3 + 3 * t2) * p2[1] + (t3 - t2) * m2[1];
  }
  /**
   * @param {number} t The index to interpolate.
   * @param {Array|TypedArray} samples the original array.
   * @return {number} The interpolated value.
   */
  sinc(t, samples) {
    t = this.scaleFactor_ * t;
    let k2 = Math.floor(t);
    let ref = k2 - this.sincFilterSize_ + 1;
    let ref1 = k2 + this.sincFilterSize_;
    let sum = 0;
    for (let n2 = ref; n2 <= ref1; n2++) {
      sum += this.kernel_(t - n2) * this.getClippedInput_(n2, samples);
    }
    return sum;
  }
  /**
   * @param {number} k The scaled index to interpolate.
   * @param {Array|TypedArray} samples the original array.
   * @return {number} The tangent.
   * @private
   */
  getTangent_(k2, samples) {
    return this.tangentFactor_ * (this.getClippedInput_(k2 + 1, samples) - this.getClippedInput_(k2 - 1, samples)) / 2;
  }
  /**
   * @param {number} t The scaled index to interpolate.
   * @param {Array|TypedArray} samples the original array.
   * @return {number} The interpolated value.
   * @private
   */
  getClippedInput_(t, samples) {
    if (0 <= t && t < this.length_) {
      return samples[t];
    }
    return 0;
  }
};
function window_(x3) {
  return Math.exp(-x3 / 2 * x3 / 2);
}
function sincKernel_(window2) {
  return function(x3) {
    return sinc_(x3) * window2(x3);
  };
}
function sinc_(x3) {
  if (x3 === 0) {
    return 1;
  }
  return Math.sin(Math.PI * x3) / (Math.PI * x3);
}

// ../../node_modules/wave-resampler/lib/fir-lpf.js
var FIRLPF = class {
  /**
   * @param {number} order The order of the filter.
   * @param {number} sampleRate The sample rate.
   * @param {number} cutOff The cut off frequency.
   */
  constructor(order, sampleRate, cutOff) {
    let omega = 2 * Math.PI * cutOff / sampleRate;
    let dc = 0;
    this.filters = [];
    for (let i2 = 0; i2 <= order; i2++) {
      if (i2 - order / 2 === 0) {
        this.filters[i2] = omega;
      } else {
        this.filters[i2] = Math.sin(omega * (i2 - order / 2)) / (i2 - order / 2);
        this.filters[i2] *= 0.54 - 0.46 * Math.cos(2 * Math.PI * i2 / order);
      }
      dc = dc + this.filters[i2];
    }
    for (let i2 = 0; i2 <= order; i2++) {
      this.filters[i2] /= dc;
    }
    this.z = this.initZ_();
  }
  /**
   * @param {number} sample A sample of a sequence.
   * @return {number}
   */
  filter(sample) {
    this.z.buf[this.z.pointer] = sample;
    let out = 0;
    for (let i2 = 0, len = this.z.buf.length; i2 < len; i2++) {
      out += this.filters[i2] * this.z.buf[(this.z.pointer + i2) % this.z.buf.length];
    }
    this.z.pointer = (this.z.pointer + 1) % this.z.buf.length;
    return out;
  }
  /**
   * Reset the filter.
   */
  reset() {
    this.z = this.initZ_();
  }
  /**
   * Return the default value for z.
   * @private
   */
  initZ_() {
    let r = [];
    for (let i2 = 0; i2 < this.filters.length - 1; i2++) {
      r.push(0);
    }
    return {
      buf: r,
      pointer: 0
    };
  }
};

// ../../node_modules/wave-resampler/lib/butterworth-lpf.js
var ButterworthLPF = class {
  /**
   * @param {number} order The order of the filter.
   * @param {number} sampleRate The sample rate.
   * @param {number} cutOff The cut off frequency.
   */
  constructor(order, sampleRate, cutOff) {
    let filters = [];
    for (let i2 = 0; i2 < order; i2++) {
      filters.push(this.getCoeffs_({
        Fs: sampleRate,
        Fc: cutOff,
        Q: 0.5 / Math.sin(Math.PI / (order * 2) * (i2 + 0.5))
      }));
    }
    this.stages = [];
    for (let i2 = 0; i2 < filters.length; i2++) {
      this.stages[i2] = {
        b0: filters[i2].b[0],
        b1: filters[i2].b[1],
        b2: filters[i2].b[2],
        a1: filters[i2].a[0],
        a2: filters[i2].a[1],
        k: filters[i2].k,
        z: [0, 0]
      };
    }
  }
  /**
   * @param {number} sample A sample of a sequence.
   * @return {number}
   */
  filter(sample) {
    let out = sample;
    for (let i2 = 0, len = this.stages.length; i2 < len; i2++) {
      out = this.runStage_(i2, out);
    }
    return out;
  }
  getCoeffs_(params) {
    let coeffs = {};
    coeffs.z = [0, 0];
    coeffs.a = [];
    coeffs.b = [];
    let p2 = this.preCalc_(params, coeffs);
    coeffs.k = 1;
    coeffs.b.push((1 - p2.cw) / (2 * p2.a0));
    coeffs.b.push(2 * coeffs.b[0]);
    coeffs.b.push(coeffs.b[0]);
    return coeffs;
  }
  preCalc_(params, coeffs) {
    let pre = {};
    let w = 2 * Math.PI * params.Fc / params.Fs;
    pre.alpha = Math.sin(w) / (2 * params.Q);
    pre.cw = Math.cos(w);
    pre.a0 = 1 + pre.alpha;
    coeffs.a0 = pre.a0;
    coeffs.a.push(-2 * pre.cw / pre.a0);
    coeffs.k = 1;
    coeffs.a.push((1 - pre.alpha) / pre.a0);
    return pre;
  }
  runStage_(i2, input) {
    let temp = input * this.stages[i2].k - this.stages[i2].a1 * this.stages[i2].z[0] - this.stages[i2].a2 * this.stages[i2].z[1];
    let out = this.stages[i2].b0 * temp + this.stages[i2].b1 * this.stages[i2].z[0] + this.stages[i2].b2 * this.stages[i2].z[1];
    this.stages[i2].z[1] = this.stages[i2].z[0];
    this.stages[i2].z[0] = temp;
    return out;
  }
  /**
   * Reset the filter.
   */
  reset() {
    for (let i2 = 0; i2 < this.stages.length; i2++) {
      this.stages[i2].z = [0, 0];
    }
  }
};

// ../../node_modules/wave-resampler/index.js
var DEFAULT_LPF_USE = {
  "point": false,
  "linear": false,
  "cubic": true,
  "sinc": true
};
var DEFAULT_LPF_ORDER = {
  "IIR": 16,
  "FIR": 71
};
var DEFAULT_LPF = {
  "IIR": ButterworthLPF,
  "FIR": FIRLPF
};
function resample(samples, oldSampleRate, sampleRate, details = {}) {
  let rate = (sampleRate - oldSampleRate) / oldSampleRate + 1;
  let newSamples = new Float64Array(samples.length * rate);
  details.method = details.method || "cubic";
  let interpolator = new Interpolator(
    samples.length,
    newSamples.length,
    {
      method: details.method,
      tension: details.tension || 0,
      sincFilterSize: details.sincFilterSize || 6,
      sincWindow: details.sincWindow || void 0
    }
  );
  if (details.LPF === void 0) {
    details.LPF = DEFAULT_LPF_USE[details.method];
  }
  if (details.LPF) {
    details.LPFType = details.LPFType || "IIR";
    const LPF = DEFAULT_LPF[details.LPFType];
    if (sampleRate > oldSampleRate) {
      let filter = new LPF(
        details.LPFOrder || DEFAULT_LPF_ORDER[details.LPFType],
        sampleRate,
        oldSampleRate / 2
      );
      upsample_(
        samples,
        newSamples,
        interpolator,
        filter
      );
    } else {
      let filter = new LPF(
        details.LPFOrder || DEFAULT_LPF_ORDER[details.LPFType],
        oldSampleRate,
        sampleRate / 2
      );
      downsample_(
        samples,
        newSamples,
        interpolator,
        filter
      );
    }
  } else {
    resample_(samples, newSamples, interpolator);
  }
  return newSamples;
}
function resample_(samples, newSamples, interpolator) {
  for (let i2 = 0, len = newSamples.length; i2 < len; i2++) {
    newSamples[i2] = interpolator.interpolate(i2, samples);
  }
}
function upsample_(samples, newSamples, interpolator, filter) {
  for (let i2 = 0, len = newSamples.length; i2 < len; i2++) {
    newSamples[i2] = filter.filter(interpolator.interpolate(i2, samples));
  }
  filter.reset();
  for (let i2 = newSamples.length - 1; i2 >= 0; i2--) {
    newSamples[i2] = filter.filter(newSamples[i2]);
  }
}
function downsample_(samples, newSamples, interpolator, filter) {
  for (let i2 = 0, len = samples.length; i2 < len; i2++) {
    samples[i2] = filter.filter(samples[i2]);
  }
  filter.reset();
  for (let i2 = samples.length - 1; i2 >= 0; i2--) {
    samples[i2] = filter.filter(samples[i2]);
  }
  resample_(samples, newSamples, interpolator);
}

// ../../node_modules/opfs-tools/dist/opfs-tools.js
var z2 = (r) => {
  throw TypeError(r);
};
var j = (r, e, t) => e.has(r) || z2("Cannot " + t);
var n = (r, e, t) => (j(r, e, "read from private field"), t ? t.call(r) : e.get(r));
var o = (r, e, t) => e.has(r) ? z2("Cannot add the same private member more than once") : e instanceof WeakSet ? e.add(r) : e.set(r, t);
var l = (r, e, t, a) => (j(r, e, "write to private field"), a ? a.call(r, t) : e.set(r, t), t);
var J = "KGZ1bmN0aW9uKCl7InVzZSBzdHJpY3QiO2Z1bmN0aW9uIHUobil7aWYobj09PSIvIilyZXR1cm57cGFyZW50Om51bGwsbmFtZToiIn07Y29uc3QgZT1uLnNwbGl0KCIvIikuZmlsdGVyKGk9PmkubGVuZ3RoPjApO2lmKGUubGVuZ3RoPT09MCl0aHJvdyBFcnJvcigiSW52YWxpZCBwYXRoIik7Y29uc3QgYT1lW2UubGVuZ3RoLTFdLHI9Ii8iK2Uuc2xpY2UoMCwtMSkuam9pbigiLyIpO3JldHVybntuYW1lOmEscGFyZW50OnJ9fWFzeW5jIGZ1bmN0aW9uIHcobixlKXtjb25zdHtwYXJlbnQ6YSxuYW1lOnJ9PXUobik7aWYoYT09bnVsbClyZXR1cm4gYXdhaXQgbmF2aWdhdG9yLnN0b3JhZ2UuZ2V0RGlyZWN0b3J5KCk7Y29uc3QgaT1hLnNwbGl0KCIvIikuZmlsdGVyKHQ9PnQubGVuZ3RoPjApO3RyeXtsZXQgdD1hd2FpdCBuYXZpZ2F0b3Iuc3RvcmFnZS5nZXREaXJlY3RvcnkoKTtmb3IoY29uc3QgcyBvZiBpKXQ9YXdhaXQgdC5nZXREaXJlY3RvcnlIYW5kbGUocyx7Y3JlYXRlOmUuY3JlYXRlfSk7aWYoZS5pc0ZpbGUpcmV0dXJuIGF3YWl0IHQuZ2V0RmlsZUhhbmRsZShyLHtjcmVhdGU6ZS5jcmVhdGV9KX1jYXRjaCh0KXtpZih0Lm5hbWU9PT0iTm90Rm91bmRFcnJvciIpcmV0dXJuIG51bGw7dGhyb3cgdH19Y29uc3QgZj17fTtzZWxmLm9ubWVzc2FnZT1hc3luYyBuPT57dmFyIGk7Y29uc3R7ZXZ0VHlwZTplLGFyZ3M6YX09bi5kYXRhO2xldCByPWZbYS5maWxlSWRdO3RyeXtsZXQgdDtjb25zdCBzPVtdO2lmKGU9PT0icmVnaXN0ZXIiKXtjb25zdCBsPWF3YWl0IHcoYS5maWxlUGF0aCx7Y3JlYXRlOiEwLGlzRmlsZTohMH0pO2lmKGw9PW51bGwpdGhyb3cgRXJyb3IoYG5vdCBmb3VuZCBmaWxlOiAke2EuZmlsZUlkfWApO3I9YXdhaXQgbC5jcmVhdGVTeW5jQWNjZXNzSGFuZGxlKHttb2RlOmEubW9kZX0pLGZbYS5maWxlSWRdPXJ9ZWxzZSBpZihlPT09ImNsb3NlIilhd2FpdCByLmNsb3NlKCksZGVsZXRlIGZbYS5maWxlSWRdO2Vsc2UgaWYoZT09PSJ0cnVuY2F0ZSIpYXdhaXQgci50cnVuY2F0ZShhLm5ld1NpemUpO2Vsc2UgaWYoZT09PSJ3cml0ZSIpe2NvbnN0e2RhdGE6bCxvcHRzOm99PW4uZGF0YS5hcmdzO3Q9YXdhaXQgci53cml0ZShsLG8pfWVsc2UgaWYoZT09PSJyZWFkIil7Y29uc3R7b2Zmc2V0Omwsc2l6ZTpvfT1uLmRhdGEuYXJncyxnPW5ldyBVaW50OEFycmF5KG8pLGQ9YXdhaXQgci5yZWFkKGcse2F0Omx9KSxjPWcuYnVmZmVyO3Q9ZD09PW8/YzooKGk9Yy50cmFuc2Zlcik9PW51bGw/dm9pZCAwOmkuY2FsbChjLGQpKT8/Yy5zbGljZSgwLGQpLHMucHVzaCh0KX1lbHNlIGU9PT0iZ2V0U2l6ZSI/dD1hd2FpdCByLmdldFNpemUoKTplPT09ImZsdXNoIiYmYXdhaXQgci5mbHVzaCgpO3NlbGYucG9zdE1lc3NhZ2Uoe2V2dFR5cGU6ImNhbGxiYWNrIixjYklkOm4uZGF0YS5jYklkLHJldHVyblZhbDp0fSxzKX1jYXRjaCh0KXtjb25zdCBzPXQ7c2VsZi5wb3N0TWVzc2FnZSh7ZXZ0VHlwZToidGhyb3dFcnJvciIsY2JJZDpuLmRhdGEuY2JJZCxlcnJNc2c6cy5uYW1lKyI6ICIrcy5tZXNzYWdlK2AKYCtKU09OLnN0cmluZ2lmeShuLmRhdGEpfSl9fX0pKCk7Ci8vIyBzb3VyY2VNYXBwaW5nVVJMPW9wZnMtd29ya2VyLUY0UldscWNfLmpzLm1hcAo=";
var D = (r) => Uint8Array.from(atob(r), (e) => e.charCodeAt(0));
var K = typeof self < "u" && self.Blob && new Blob([D(J)], { type: "text/javascript;charset=utf-8" });
function M(r) {
  let e;
  try {
    if (e = K && (self.URL || self.webkitURL).createObjectURL(K), !e) throw "";
    const t = new Worker(e, {
      name: r == null ? void 0 : r.name
    });
    return t.addEventListener("error", () => {
      (self.URL || self.webkitURL).revokeObjectURL(e);
    }), t;
  } catch {
    return new Worker(
      "data:text/javascript;base64," + J,
      {
        name: r == null ? void 0 : r.name
      }
    );
  } finally {
    e && (self.URL || self.webkitURL).revokeObjectURL(e);
  }
}
async function _2(r, e, t) {
  const a = A2();
  return await a("register", { fileId: r, filePath: e, mode: t }), {
    read: async (i2, s) => await a("read", {
      fileId: r,
      offset: i2,
      size: s
    }),
    write: async (i2, s) => await a(
      "write",
      {
        fileId: r,
        data: i2,
        opts: s
      },
      [ArrayBuffer.isView(i2) ? i2.buffer : i2]
    ),
    close: async () => await a("close", {
      fileId: r
    }),
    truncate: async (i2) => await a("truncate", {
      fileId: r,
      newSize: i2
    }),
    getSize: async () => await a("getSize", {
      fileId: r
    }),
    flush: async () => await a("flush", {
      fileId: r
    })
  };
}
var v = [];
var x = 0;
function A2() {
  if (v.length < 3) {
    const e = r();
    return v.push(e), e;
  } else {
    const e = v[x];
    return x = (x + 1) % v.length, e;
  }
  function r() {
    const e = new M();
    let t = 0, a = {};
    return e.onmessage = ({
      data: i2
    }) => {
      var s, c;
      i2.evtType === "callback" ? (s = a[i2.cbId]) == null || s.resolve(i2.returnVal) : i2.evtType === "throwError" && ((c = a[i2.cbId]) == null || c.reject(Error(i2.errMsg))), delete a[i2.cbId];
    }, async function(s, c, h = []) {
      t += 1;
      const w = new Promise((b, k2) => {
        a[t] = { resolve: b, reject: k2 };
      });
      return e.postMessage(
        {
          cbId: t,
          evtType: s,
          args: c
        },
        h
      ), w;
    };
  }
}
function V2(r) {
  if (r === "/") return { parent: null, name: "" };
  const e = r.split("/").filter((i2) => i2.length > 0);
  if (e.length === 0) throw Error("Invalid path");
  const t = e[e.length - 1], a = "/" + e.slice(0, -1).join("/");
  return { name: t, parent: a };
}
async function m(r, e) {
  const { parent: t, name: a } = V2(r);
  if (t == null) return await navigator.storage.getDirectory();
  const i2 = t.split("/").filter((s) => s.length > 0);
  try {
    let s = await navigator.storage.getDirectory();
    for (const c of i2)
      s = await s.getDirectoryHandle(c, {
        create: e.create
      });
    return e.isFile ? await s.getFileHandle(a, {
      create: e.create
    }) : await s.getDirectoryHandle(a, {
      create: e.create
    });
  } catch (s) {
    if (s.name === "NotFoundError")
      return null;
    throw s;
  }
}
async function L2(r) {
  const { parent: e, name: t } = V2(r);
  if (e == null) {
    const i2 = await navigator.storage.getDirectory();
    for await (const s of i2.keys())
      await i2.removeEntry(s, { recursive: true });
    return;
  }
  const a = await m(e, {
    create: false,
    isFile: false
  });
  if (a != null)
    try {
      await a.removeEntry(t, { recursive: true });
    } catch (i2) {
      if (i2.name === "NotFoundError") return;
      throw i2;
    }
}
function E2(r, e) {
  return `${r}/${e}`.replace("//", "/");
}
function g(r) {
  return new T(r);
}
var f;
var S2;
var p;
var C2 = class C3 {
  constructor(e) {
    o(this, f);
    o(this, S2);
    o(this, p);
    l(this, f, e);
    const { parent: t, name: a } = V2(e);
    l(this, S2, a), l(this, p, t);
  }
  get kind() {
    return "dir";
  }
  get name() {
    return n(this, S2);
  }
  get path() {
    return n(this, f);
  }
  get parent() {
    return n(this, p) == null ? null : g(n(this, p));
  }
  /**
   * Creates the directory.
   * return A promise that resolves when the directory is created.
   */
  async create() {
    return await m(n(this, f), {
      create: true,
      isFile: false
    }), g(n(this, f));
  }
  /**
   * Checks if the directory exists.
   * return A promise that resolves to true if the directory exists, otherwise false.
   */
  async exists() {
    return await m(n(this, f), {
      create: false,
      isFile: false
    }) instanceof FileSystemDirectoryHandle;
  }
  /**
   * Removes the directory.
   * return A promise that resolves when the directory is removed.
   */
  async remove(e = {}) {
    for (const t of await this.children())
      try {
        await t.remove(e);
      } catch (a) {
        console.warn(a);
      }
    try {
      await L2(n(this, f));
    } catch (t) {
      console.warn(t);
    }
  }
  /**
   * Retrieves the children of the directory.
   * return A promise that resolves to an array of objects representing the children.
   */
  async children() {
    const e = await m(n(this, f), {
      create: false,
      isFile: false
    });
    if (e == null) return [];
    const t = [];
    for await (const a of e.values())
      t.push((a.kind === "file" ? F2 : g)(E2(n(this, f), a.name)));
    return t;
  }
  async copyTo(e) {
    if (!await this.exists())
      throw Error(`dir ${this.path} not exists`);
    if (e instanceof C3) {
      const t = await e.exists() ? g(E2(e.path, this.name)) : e;
      return await t.create(), await Promise.all((await this.children()).map((a) => a.copyTo(t))), t;
    } else if (e instanceof FileSystemDirectoryHandle)
      return await Promise.all(
        (await this.children()).map(async (t) => {
          t.kind === "file" ? await t.copyTo(
            await e.getFileHandle(t.name, { create: true })
          ) : await t.copyTo(
            await e.getDirectoryHandle(t.name, { create: true })
          );
        })
      ), null;
    throw Error("Illegal target type");
  }
  /**
   * move directory, copy then remove current
   */
  async moveTo(e) {
    const t = await this.copyTo(e);
    return await this.remove(), t;
  }
};
f = /* @__PURE__ */ new WeakMap(), S2 = /* @__PURE__ */ new WeakMap(), p = /* @__PURE__ */ new WeakMap();
var T = C2;
var P = /* @__PURE__ */ new Map();
function F2(r, e = "rw") {
  if (e === "rw") {
    const t = P.get(r) ?? new W(r, e);
    return P.set(r, t), t;
  }
  return new W(r, e);
}
async function B2(r, e, t = { overwrite: true }) {
  if (e instanceof W) {
    await B2(r, await e.stream(), t);
    return;
  }
  const a = await (r instanceof W ? r : F2(r, "rw")).createWriter();
  try {
    if (t.overwrite && await a.truncate(0), e instanceof ReadableStream) {
      const i2 = e.getReader();
      for (; ; ) {
        const { done: s, value: c } = await i2.read();
        if (s) break;
        await a.write(c);
      }
    } else
      await a.write(e);
  } catch (i2) {
    throw i2;
  } finally {
    await a.close();
  }
}
var $2 = 0;
var q = () => ++$2;
var u;
var Z;
var G;
var Y;
var X;
var d;
var R;
var I;
var y;
var O2 = class O3 {
  constructor(e, t) {
    o(this, u);
    o(this, Z);
    o(this, G);
    o(this, Y);
    o(this, X);
    o(this, d, 0);
    o(this, R, async () => {
    });
    o(this, I, /* @__PURE__ */ (() => {
      let e2 = null;
      return () => (l(this, d, n(this, d) + 1), e2 != null || (e2 = new Promise(async (t2, a2) => {
        try {
          const i3 = await _2(
            n(this, X),
            n(this, u),
            n(this, Y)
          );
          l(this, R, async () => {
            e2 != null && (e2 = null, l(this, d, 0), await i3.close().catch(console.error));
          }), t2([
            i3,
            async () => {
              l(this, d, n(this, d) - 1), !(n(this, d) > 0) && (e2 = null, await i3.close());
            }
          ]);
        } catch (i3) {
          a2(i3);
        }
      })), e2);
    })());
    o(this, y, false);
    l(this, X, q()), l(this, u, e), l(this, Y, {
      r: "read-only",
      rw: "readwrite",
      "rw-unsafe": "readwrite-unsafe"
    }[t]);
    const { parent: a, name: i2 } = V2(e);
    if (a == null) throw Error("Invalid path");
    l(this, G, i2), l(this, Z, a);
  }
  get kind() {
    return "file";
  }
  get path() {
    return n(this, u);
  }
  get name() {
    return n(this, G);
  }
  get parent() {
    return n(this, Z) == null ? null : g(n(this, Z));
  }
  /**
   * Random write to file
   */
  async createWriter() {
    if (n(this, Y) === "read-only") throw Error("file is read-only");
    if (n(this, y)) throw Error("Other writer have not been closed");
    l(this, y, true);
    try {
      const e = new TextEncoder(), [t, a] = await n(this, I).call(this);
      let i2 = await t.getSize(), s = false;
      return {
        write: async (c, h = {}) => {
          if (s) throw Error("Writer is closed");
          const w = typeof c == "string" ? e.encode(c) : c, b = h.at ?? i2, k2 = w.byteLength;
          return i2 = b + k2, await t.write(w, { at: b });
        },
        truncate: async (c) => {
          if (s) throw Error("Writer is closed");
          await t.truncate(c), i2 > c && (i2 = c);
        },
        flush: async () => {
          if (s) throw Error("Writer is closed");
          await t.flush();
        },
        close: async () => {
          if (s) throw Error("Writer is closed");
          s = true, l(this, y, false), await a();
        }
      };
    } catch (e) {
      throw l(this, y, false), e;
    }
  }
  /**
   * Random access to file
   */
  async createReader() {
    const [e, t] = await n(this, I).call(this);
    let a = false, i2 = 0;
    return {
      read: async (s, c = {}) => {
        if (a) throw Error("Reader is closed");
        const h = c.at ?? i2, w = await e.read(h, s);
        return i2 = h + w.byteLength, w;
      },
      getSize: async () => {
        if (a) throw Error("Reader is closed");
        return await e.getSize();
      },
      close: async () => {
        a || (a = true, await t());
      }
    };
  }
  async text() {
    return new TextDecoder().decode(await this.arrayBuffer());
  }
  async arrayBuffer() {
    const e = await m(n(this, u), { create: false, isFile: true });
    return e == null ? new ArrayBuffer(0) : (await e.getFile()).arrayBuffer();
  }
  async stream() {
    const e = await this.getOriginFile();
    return e == null ? new ReadableStream({
      pull: (t) => {
        t.close();
      }
    }) : e.stream();
  }
  async getOriginFile() {
    var e;
    return (e = await m(n(this, u), { create: false, isFile: true })) == null ? void 0 : e.getFile();
  }
  async getSize() {
    const e = await m(n(this, u), { create: false, isFile: true });
    return e == null ? 0 : (await e.getFile()).size;
  }
  async exists() {
    return await m(n(this, u), {
      create: false,
      isFile: true
    }) instanceof FileSystemFileHandle;
  }
  async remove(e = {}) {
    if (e.force === true) {
      await n(this, R).call(this), await L2(n(this, u)), P.delete(n(this, u));
      return;
    }
    if (n(this, d) > 0) throw Error("exists unclosed reader/writer");
    await L2(n(this, u));
  }
  async copyTo(e) {
    if (e instanceof O3)
      return e.path === this.path ? this : (await B2(e, this), e);
    if (e instanceof T) {
      if (!await this.exists())
        throw Error(`file ${this.path} not exists`);
      return await this.copyTo(F2(E2(e.path, this.name)));
    } else if (e instanceof FileSystemFileHandle)
      return await (await this.stream()).pipeTo(await e.createWritable()), null;
    throw Error("Illegal target type");
  }
  /**
   * move file, copy then remove current
   */
  async moveTo(e) {
    const t = await this.copyTo(e);
    return await this.remove(), t;
  }
};
u = /* @__PURE__ */ new WeakMap(), Z = /* @__PURE__ */ new WeakMap(), G = /* @__PURE__ */ new WeakMap(), Y = /* @__PURE__ */ new WeakMap(), X = /* @__PURE__ */ new WeakMap(), d = /* @__PURE__ */ new WeakMap(), R = /* @__PURE__ */ new WeakMap(), I = /* @__PURE__ */ new WeakMap(), y = /* @__PURE__ */ new WeakMap();
var W = O2;
var U2 = "/.opfs-tools-temp-dir";
async function Q(r) {
  try {
    if (r.kind === "file") {
      if (!await r.exists()) return true;
      const e = await r.createWriter();
      await e.truncate(0), await e.close(), await r.remove();
    } else
      await r.remove();
    return true;
  } catch (e) {
    return console.warn(e), false;
  }
}
function ee() {
  setInterval(async () => {
    for (const e of await g(U2).children()) {
      const t = /^\d+-(\d+)$/.exec(e.name);
      (t == null || Date.now() - Number(t[1]) > 2592e5) && await Q(e);
    }
  }, 60 * 1e3);
}
var H = [];
var N = false;
async function te() {
  if (globalThis.localStorage == null) return;
  const r = "OPFS_TOOLS_EXPIRES_TMP_FILES";
  N || (N = true, globalThis.addEventListener("unload", () => {
    H.length !== 0 && localStorage.setItem(
      r,
      `${localStorage.getItem(r) ?? ""},${H.join(",")}`
    );
  }));
  let e = localStorage.getItem(r) ?? "";
  for (const t of e.split(","))
    t.length !== 0 && await Q(F2(`${U2}/${t}`)) && (e = e.replace(t, ""));
  localStorage.setItem(r, e.replace(/,{2,}/g, ","));
}
(async function() {
  var e;
  globalThis.__opfs_tools_tmpfile_init__ !== true && (globalThis.__opfs_tools_tmpfile_init__ = true, !(globalThis.FileSystemDirectoryHandle == null || globalThis.FileSystemFileHandle == null || ((e = globalThis.navigator) == null ? void 0 : e.storage.getDirectory) == null) && (ee(), await te()));
})();
function ae() {
  const r = `${Math.random().toString().slice(2)}-${Date.now()}`;
  return H.push(r), F2(`${U2}/${r}`);
}

// ../../node_modules/@webav/av-cliper/dist/av-cliper.js
function et(s) {
  if (s.format === "f32-planar") {
    const t = [];
    for (let e = 0; e < s.numberOfChannels; e += 1) {
      const i2 = s.allocationSize({ planeIndex: e }), n2 = new ArrayBuffer(i2);
      s.copyTo(n2, { planeIndex: e }), t.push(new Float32Array(n2));
    }
    return t;
  } else if (s.format === "f32") {
    const t = new ArrayBuffer(s.allocationSize({ planeIndex: 0 }));
    return s.copyTo(t, { planeIndex: 0 }), Et(new Float32Array(t), s.numberOfChannels);
  } else if (s.format === "s16") {
    const t = new ArrayBuffer(s.allocationSize({ planeIndex: 0 }));
    return s.copyTo(t, { planeIndex: 0 }), Rt(new Int16Array(t), s.numberOfChannels);
  }
  throw Error("Unsupported audio data format");
}
function Rt(s, t) {
  const e = s.length / t, i2 = Array.from(
    { length: t },
    () => new Float32Array(e)
  );
  for (let n2 = 0; n2 < e; n2++)
    for (let a = 0; a < t; a++) {
      const r = s[n2 * t + a];
      i2[a][n2] = r / 32768;
    }
  return i2;
}
function Et(s, t) {
  const e = s.length / t, i2 = Array.from(
    { length: t },
    () => new Float32Array(e)
  );
  for (let n2 = 0; n2 < e; n2++)
    for (let a = 0; a < t; a++)
      i2[a][n2] = s[n2 * t + a];
  return i2;
}
function $3(s) {
  return Array(s.numberOfChannels).fill(0).map((t, e) => s.getChannelData(e));
}
async function Pt(s, t, e) {
  const i2 = s.length, n2 = Array(e.chanCount).fill(0).map(() => new Float32Array(0));
  if (i2 === 0) return n2;
  const a = Math.max(...s.map((l2) => l2.length));
  if (a === 0) return n2;
  if (globalThis.OfflineAudioContext == null)
    return s.map(
      (l2) => new Float32Array(
        resample(l2, t, e.rate, {
          method: "sinc",
          LPF: false
        })
      )
    );
  const r = new globalThis.OfflineAudioContext(
    e.chanCount,
    a * e.rate / t,
    e.rate
  ), o2 = r.createBufferSource(), c = r.createBuffer(i2, a, t);
  return s.forEach((l2, h) => c.copyToChannel(l2, h)), o2.buffer = c, o2.connect(r.destination), o2.start(), $3(await r.startRendering());
}
function H2(s) {
  return new Promise((t) => {
    const e = _(() => {
      e(), t();
    }, s);
  });
}
var x2 = {
  sampleRate: 48e3,
  channelCount: 2,
  codec: "mp4a.40.2"
};
function W2(s, t) {
  const e = t.videoTracks[0], i2 = {};
  if (e != null) {
    const a = Mt(s.getTrackById(e.id))?.buffer, { descKey: r, type: o2 } = e.codec.startsWith("avc1") ? { descKey: "avcDecoderConfigRecord", type: "avc1" } : e.codec.startsWith("hvc1") ? { descKey: "hevcDecoderConfigRecord", type: "hvc1" } : { descKey: "", type: "" };
    r !== "" && (i2.videoTrackConf = {
      timescale: e.timescale,
      duration: e.duration,
      width: e.video.width,
      height: e.video.height,
      brands: t.brands,
      type: o2,
      [r]: a
    }), i2.videoDecoderConf = {
      codec: e.codec,
      codedHeight: e.video.height,
      codedWidth: e.video.width,
      description: a
    };
  }
  const n2 = t.audioTracks[0];
  if (n2 != null) {
    const a = Bt(s), r = a == null ? {} : _t(a);
    i2.audioTrackConf = {
      timescale: n2.timescale,
      samplerate: r.sampleRate ?? n2.audio.sample_rate,
      channel_count: r.numberOfChannels ?? n2.audio.channel_count,
      hdlr: "soun",
      type: n2.codec.startsWith("mp4a") ? "mp4a" : n2.codec,
      description: a
    }, i2.audioDecoderConf = {
      codec: r.codec ?? x2.codec,
      numberOfChannels: r.numberOfChannels ?? n2.audio.channel_count,
      sampleRate: r.sampleRate ?? n2.audio.sample_rate
    };
  }
  return i2;
}
function Mt(s) {
  for (const t of s.mdia.minf.stbl.stsd.entries) {
    const e = t.avcC ?? t.hvcC ?? t.av1C ?? t.vpcC;
    if (e != null) {
      const i2 = new import_mp4box2.default.DataStream(
        void 0,
        0,
        import_mp4box2.default.DataStream.BIG_ENDIAN
      );
      return e.write(i2), new Uint8Array(i2.buffer.slice(8));
    }
  }
}
function Bt(s, t = "mp4a") {
  return s.moov?.traks.map((i2) => i2.mdia.minf.stbl.stsd.entries).flat().find(({ type: i2 }) => i2 === t)?.esds;
}
function _t(s) {
  let t = "mp4a";
  const e = s.esd.descs[0];
  if (e == null) return {};
  t += "." + e.oti.toString(16);
  const i2 = e.descs[0];
  if (i2 == null)
    return t.endsWith("40") && (t += ".2"), { codec: t };
  const n2 = (i2.data[0] & 248) >> 3;
  t += "." + n2;
  const [a, r] = i2.data, o2 = ((a & 7) << 1) + (r >> 7), c = (r & 127) >> 3;
  return {
    codec: t,
    sampleRate: [
      96e3,
      88200,
      64e3,
      48e3,
      44100,
      32e3,
      24e3,
      22050,
      16e3,
      12e3,
      11025,
      8e3,
      7350
    ][o2],
    numberOfChannels: c
  };
}
async function Ot(s, t, e) {
  const i2 = import_mp4box2.default.createFile(false);
  i2.onReady = (a) => {
    t({ mp4boxFile: i2, info: a });
    const r = a.videoTracks[0]?.id;
    r != null && i2.setExtractionOptions(r, "video", { nbSamples: 100 });
    const o2 = a.audioTracks[0]?.id;
    o2 != null && i2.setExtractionOptions(o2, "audio", { nbSamples: 100 }), i2.start();
  }, i2.onSamples = e, await n2();
  async function n2() {
    let a = 0;
    const r = 30 * 1024 * 1024;
    for (; ; ) {
      const o2 = await s.read(r, {
        at: a
      });
      if (o2.byteLength === 0) break;
      o2.fileStart = a;
      const c = i2.appendBuffer(o2);
      if (c == null) break;
      a = c;
    }
    i2.stop();
  }
}
function zt(s) {
  if (s?.length !== 9) return {};
  const t = new Int32Array(s.buffer), e = t[0] / 65536, i2 = t[1] / 65536, n2 = t[3] / 65536, a = t[4] / 65536, r = t[6] / 65536, o2 = t[7] / 65536, c = t[8] / (1 << 30), l2 = Math.sqrt(e * e + n2 * n2), h = Math.sqrt(i2 * i2 + a * a), u2 = Math.atan2(n2, e), d2 = u2 * 180 / Math.PI;
  return {
    scaleX: l2,
    scaleY: h,
    rotationRad: u2,
    rotationDeg: d2,
    translateX: r,
    translateY: o2,
    perspective: c
  };
}
function Vt(s, t, e) {
  const i2 = (Math.round(e / 90) * 90 + 360) % 360;
  if (i2 === 0) return (c) => c;
  const n2 = i2 === 90 || i2 === 270 ? t : s, a = i2 === 90 || i2 === 270 ? s : t, r = new OffscreenCanvas(n2, a), o2 = r.getContext("2d");
  return o2.translate(n2 / 2, a / 2), o2.rotate(-i2 * Math.PI / 180), o2.translate(-s / 2, -t / 2), (c) => {
    if (c == null) return null;
    o2.drawImage(c, 0, 0);
    const l2 = new VideoFrame(r, {
      timestamp: c.timestamp,
      duration: c.duration ?? void 0
    });
    return c.close(), l2;
  };
}
var X2 = 0;
function B3(s) {
  return s.kind === "file" && s.createReader instanceof Function;
}
var I2 = class _I {
  #t = X2++;
  #n = S.create(`MP4Clip id:${this.#t},`);
  ready;
  #e = false;
  #s = {
    // 微秒
    duration: 0,
    width: 0,
    height: 0,
    audioSampleRate: 0,
    audioChanCount: 0
  };
  get meta() {
    return { ...this.#s };
  }
  #a;
  /** 存储视频头（box: ftyp, moov）的二进制数据 */
  #r = [];
  /**
   * 提供视频头（box: ftyp, moov）的二进制数据
   * 使用任意 mp4 demxer 解析即可获得详细的视频信息
   * 单元测试包含使用 mp4box.js 解析示例代码
   */
  async getFileHeaderBinData() {
    await this.ready;
    const t = await this.#a.getOriginFile();
    if (t == null) throw Error("MP4Clip localFile is not origin file");
    return await new Blob(
      this.#r.map(
        ({ start: e, size: i2 }) => t.slice(e, e + i2)
      )
    ).arrayBuffer();
  }
  /**存储视频平移旋转信息，目前只还原旋转 */
  #i = {
    perspective: 1,
    rotationRad: 0,
    rotationDeg: 0,
    scaleX: 1,
    scaleY: 1,
    translateX: 0,
    translateY: 0
  };
  #o = (t) => t;
  #l = 1;
  #c = [];
  #d = [];
  #m = null;
  #u = null;
  #f = {
    video: null,
    audio: null
  };
  #h = { audio: true };
  constructor(t, e = {}) {
    if (!(t instanceof ReadableStream) && !B3(t) && !Array.isArray(t.videoSamples))
      throw Error("Illegal argument");
    this.#h = { audio: true, ...e }, this.#l = typeof e.audio == "object" && "volume" in e.audio ? e.audio.volume : 1;
    const i2 = async (n2) => (await B2(this.#a, n2), this.#a);
    this.#a = B3(t) ? t : "localFile" in t ? t.localFile : ae(), this.ready = (t instanceof ReadableStream ? i2(t).then(
      (n2) => J2(n2, this.#h)
    ) : B3(t) ? J2(t, this.#h) : Promise.resolve(t)).then(
      async ({
        videoSamples: n2,
        audioSamples: a,
        decoderConf: r,
        headerBoxPos: o2,
        parsedMatrix: c
      }) => {
        this.#c = n2, this.#d = a, this.#f = r, this.#r = o2, this.#i = c;
        const { videoFrameFinder: l2, audioFrameFinder: h } = Ut(
          {
            video: r.video == null ? null : {
              ...r.video,
              hardwareAcceleration: this.#h.__unsafe_hardwareAcceleration__
            },
            audio: r.audio
          },
          await this.#a.createReader(),
          n2,
          a,
          this.#h.audio !== false ? this.#l : 0
        );
        this.#m = l2, this.#u = h;
        const { codedWidth: u2, codedHeight: d2 } = r.video ?? {};
        return u2 && d2 && (this.#o = Vt(
          u2,
          d2,
          c.rotationDeg
        )), this.#s = Lt(
          r,
          n2,
          a,
          c.rotationDeg
        ), this.#n.info("MP4Clip meta:", this.#s), { ...this.#s };
      }
    );
  }
  /**
   * 拦截 {@link MP4Clip.tick} 方法返回的数据，用于对图像、音频数据二次处理
   * @param time 调用 tick 的时间
   * @param tickRet tick 返回的数据
   *
   * @see [移除视频绿幕背景](https://webav-tech.github.io/WebAV/demo/3_2-chromakey-video)
   */
  tickInterceptor = async (t, e) => e;
  /**
   * 获取素材指定时刻的图像帧、音频数据
   * @param time 微秒
   */
  async tick(t) {
    if (t >= this.#s.duration)
      return await this.tickInterceptor(t, {
        audio: await this.#u?.find(t) ?? [],
        state: "done"
      });
    const [e, i2] = await Promise.all([
      this.#u?.find(t) ?? [],
      this.#m?.find(t).then(this.#o)
    ]);
    return i2 == null ? await this.tickInterceptor(t, {
      audio: e,
      state: "success"
    }) : await this.tickInterceptor(t, {
      video: i2,
      audio: e,
      state: "success"
    });
  }
  #p = new AbortController();
  /**
   * 生成缩略图，默认每个关键帧生成一个 100px 宽度的缩略图。
   *
   * @param imgWidth 缩略图宽度，默认 100
   * @param opts Partial<ThumbnailOpts>
   * @returns Promise<Array<{ ts: number; img: Blob }>>
   */
  async thumbnails(t = 100, e) {
    this.#p.abort(), this.#p = new AbortController();
    const i2 = this.#p.signal;
    await this.ready;
    const n2 = "generate thumbnails aborted";
    if (i2.aborted) throw Error(n2);
    const { width: a, height: r } = this.#s, o2 = Xt(
      t,
      Math.round(r * (t / a)),
      { quality: 0.1, type: "image/png" }
    );
    return new Promise(
      async (c, l2) => {
        let h = [];
        const u2 = this.#f.video;
        if (u2 == null || this.#c.length === 0) {
          d2();
          return;
        }
        i2.addEventListener("abort", () => {
          l2(Error(n2));
        });
        async function d2() {
          i2.aborted || c(
            await Promise.all(
              h.map(async (p2) => ({
                ts: p2.ts,
                img: await p2.img
              }))
            )
          );
        }
        function y2(p2) {
          h.push({
            ts: p2.timestamp,
            img: o2(p2)
          });
        }
        const { start: m2 = 0, end: f2 = this.#s.duration, step: w } = e ?? {};
        if (w) {
          let p2 = m2;
          const g2 = new nt(
            await this.#a.createReader(),
            this.#c,
            {
              ...u2,
              hardwareAcceleration: this.#h.__unsafe_hardwareAcceleration__
            }
          );
          for (; p2 <= f2 && !i2.aborted; ) {
            const b = await g2.find(p2);
            b && y2(b), p2 += w;
          }
          g2.destroy(), d2();
        } else
          await Jt(
            this.#c,
            this.#a,
            u2,
            i2,
            { start: m2, end: f2 },
            (p2, g2) => {
              p2 != null && y2(p2), g2 && d2();
            }
          );
      }
    );
  }
  async split(t) {
    if (await this.ready, t <= 0 || t >= this.#s.duration)
      throw Error('"time" out of bounds');
    const [e, i2] = Yt(
      this.#c,
      t
    ), [n2, a] = Gt(
      this.#d,
      t
    ), r = new _I(
      {
        localFile: this.#a,
        videoSamples: e ?? [],
        audioSamples: n2 ?? [],
        decoderConf: this.#f,
        headerBoxPos: this.#r,
        parsedMatrix: this.#i
      },
      this.#h
    ), o2 = new _I(
      {
        localFile: this.#a,
        videoSamples: i2 ?? [],
        audioSamples: a ?? [],
        decoderConf: this.#f,
        headerBoxPos: this.#r,
        parsedMatrix: this.#i
      },
      this.#h
    );
    return await Promise.all([r.ready, o2.ready]), [r, o2];
  }
  async clone() {
    await this.ready;
    const t = new _I(
      {
        localFile: this.#a,
        videoSamples: [...this.#c],
        audioSamples: [...this.#d],
        decoderConf: this.#f,
        headerBoxPos: this.#r,
        parsedMatrix: this.#i
      },
      this.#h
    );
    return await t.ready, t.tickInterceptor = this.tickInterceptor, t;
  }
  /**
   * 拆分 MP4Clip 为仅包含视频轨道和音频轨道的 MP4Clip
   * @returns Mp4CLip[]
   */
  async splitTrack() {
    await this.ready;
    const t = [];
    if (this.#c.length > 0) {
      const e = new _I(
        {
          localFile: this.#a,
          videoSamples: [...this.#c],
          audioSamples: [],
          decoderConf: {
            video: this.#f.video,
            audio: null
          },
          headerBoxPos: this.#r,
          parsedMatrix: this.#i
        },
        this.#h
      );
      await e.ready, e.tickInterceptor = this.tickInterceptor, t.push(e);
    }
    if (this.#d.length > 0) {
      const e = new _I(
        {
          localFile: this.#a,
          videoSamples: [],
          audioSamples: [...this.#d],
          decoderConf: {
            audio: this.#f.audio,
            video: null
          },
          headerBoxPos: this.#r,
          parsedMatrix: this.#i
        },
        this.#h
      );
      await e.ready, e.tickInterceptor = this.tickInterceptor, t.push(e);
    }
    return t;
  }
  destroy() {
    this.#e || (this.#n.info("MP4Clip destroy"), this.#e = true, this.#m?.destroy(), this.#u?.destroy());
  }
};
function Lt(s, t, e, i2) {
  const n2 = {
    duration: 0,
    width: 0,
    height: 0,
    audioSampleRate: 0,
    audioChanCount: 0
  };
  if (s.video != null && t.length > 0) {
    n2.width = s.video.codedWidth ?? 0, n2.height = s.video.codedHeight ?? 0;
    const o2 = (Math.round(i2 / 90) * 90 + 360) % 360;
    (o2 === 90 || o2 === 270) && ([n2.width, n2.height] = [n2.height, n2.width]);
  }
  s.audio != null && e.length > 0 && (n2.audioSampleRate = x2.sampleRate, n2.audioChanCount = x2.channelCount);
  let a = 0, r = 0;
  if (t.length > 0)
    for (let o2 = t.length - 1; o2 >= 0; o2--) {
      const c = t[o2];
      if (!c.deleted) {
        a = c.cts + c.duration;
        break;
      }
    }
  if (e.length > 0) {
    const o2 = e.at(-1);
    r = o2.cts + o2.duration;
  }
  return n2.duration = Math.max(a, r), n2;
}
function Ut(s, t, e, i2, n2) {
  return {
    audioFrameFinder: n2 === 0 || s.audio == null || i2.length === 0 ? null : new $t(
      t,
      i2,
      s.audio,
      {
        volume: n2,
        targetSampleRate: x2.sampleRate
      }
    ),
    videoFrameFinder: s.video == null || e.length === 0 ? null : new nt(
      t,
      e,
      s.video
    )
  };
}
async function J2(s, t = {}) {
  let e = null;
  const i2 = { video: null, audio: null };
  let n2 = [], a = [], r = [];
  const o2 = {
    perspective: 1,
    rotationRad: 0,
    rotationDeg: 0,
    scaleX: 1,
    scaleY: 1,
    translateX: 0,
    translateY: 0
  };
  let c = -1, l2 = -1;
  const h = await s.createReader();
  await Ot(
    h,
    async (d2) => {
      e = d2.info;
      const y2 = d2.mp4boxFile.ftyp;
      r.push({ start: y2.start, size: y2.size });
      const m2 = d2.mp4boxFile.moov;
      r.push({ start: m2.start, size: m2.size }), Object.assign(o2, zt(e.videoTracks[0]?.matrix));
      let { videoDecoderConf: f2, audioDecoderConf: w } = W2(
        d2.mp4boxFile,
        d2.info
      );
      if (i2.video = f2 ?? null, i2.audio = w ?? null, f2 == null && w == null && S.error("MP4Clip no video and audio track"), w != null) {
        const { supported: p2 } = await AudioDecoder.isConfigSupported(w);
        p2 || S.error(`MP4Clip audio codec is not supported: ${w.codec}`);
      }
      if (f2 != null) {
        const { supported: p2 } = await VideoDecoder.isConfigSupported(f2);
        p2 || S.error(`MP4Clip video codec is not supported: ${f2.codec}`);
      }
      S.info(
        "mp4BoxFile moov ready",
        {
          ...d2.info,
          tracks: null,
          videoTracks: null,
          audioTracks: null
        },
        i2
      );
    },
    (d2, y2, m2) => {
      if (y2 === "video") {
        c === -1 && (c = m2[0].dts);
        for (const f2 of m2)
          n2.push(Q2(f2, c, "video"));
      } else if (y2 === "audio" && t.audio) {
        l2 === -1 && (l2 = m2[0].dts);
        for (const f2 of m2)
          a.push(Q2(f2, l2, "audio"));
      }
    }
  ), await h.close();
  const u2 = n2.at(-1) ?? a.at(-1);
  if (e == null)
    throw Error("MP4Clip stream is done, but not emit ready");
  if (u2 == null)
    throw Error("MP4Clip stream not contain any sample");
  return L3(n2), S.info("mp4 stream parsed"), {
    videoSamples: n2,
    audioSamples: a,
    decoderConf: i2,
    headerBoxPos: r,
    parsedMatrix: o2
  };
}
function Q2(s, t = 0, e) {
  let i2 = s.offset;
  const n2 = e === "video" && s.is_sync ? jt(s.data, s.description.type) : -1;
  let a = s.size;
  return n2 > 0 && (i2 += n2, a -= n2), {
    ...s,
    is_idr: n2 >= 0,
    offset: i2,
    size: a,
    cts: (s.cts - t) / s.timescale * 1e6,
    dts: (s.dts - t) / s.timescale * 1e6,
    duration: s.duration / s.timescale * 1e6,
    timescale: 1e6,
    // 音频数据量可控，直接保存在内存中
    data: e === "video" ? null : s.data
  };
}
var nt = class {
  constructor(t, e, i2) {
    this.localFileReader = t, this.samples = e, this.conf = i2;
  }
  #t = null;
  #n = 0;
  #e = { abort: false, st: performance.now() };
  find = async (t) => {
    (this.#t == null || this.#t.state === "closed" || t <= this.#n || t - this.#n > 3e6) && this.#h(t), this.#e.abort = true, this.#n = t, this.#e = { abort: false, st: performance.now() };
    const e = await this.#m(t, this.#t, this.#e);
    return this.#c = 0, e;
  };
  // fix VideoFrame duration is null
  #s = 0;
  #a = false;
  #r = 0;
  #i = [];
  #o = 0;
  #l = 0;
  #c = 0;
  #d = false;
  #m = async (t, e, i2) => {
    if (e == null || e.state === "closed" || i2.abort) return null;
    if (this.#i.length > 0) {
      const n2 = this.#i[0];
      return t < n2.timestamp ? null : (this.#i.shift(), t > n2.timestamp + (n2.duration ?? 0) ? (n2.close(), await this.#m(t, e, i2)) : (!this.#d && this.#i.length < 10 && this.#f(e).catch((a) => {
        throw this.#d = true, this.#h(t), a;
      }), n2));
    }
    if (this.#u || this.#o < this.#l && e.decodeQueueSize > 0) {
      if (performance.now() - i2.st > 6e3)
        throw Error(
          `MP4Clip.tick video timeout, ${JSON.stringify(this.#p())}`
        );
      this.#c += 1, await H2(15);
    } else {
      if (this.#r >= this.samples.length)
        return null;
      try {
        await this.#f(e);
      } catch (n2) {
        throw this.#h(t), n2;
      }
    }
    return await this.#m(t, e, i2);
  };
  #u = false;
  #f = async (t) => {
    if (this.#u || t.decodeQueueSize > 600) return;
    let e = this.#r + 1;
    if (e > this.samples.length) return;
    this.#u = true;
    let i2 = false;
    for (; e < this.samples.length; e++) {
      const n2 = this.samples[e];
      if (!i2 && !n2.deleted && (i2 = true), n2.is_idr) break;
    }
    if (i2) {
      const n2 = this.samples.slice(this.#r, e);
      if (n2[0]?.is_idr !== true)
        S.warn("First sample not idr frame");
      else {
        const a = performance.now(), r = await st(n2, this.localFileReader), o2 = performance.now() - a;
        if (o2 > 1e3) {
          const c = n2[0], l2 = n2.at(-1), h = l2.offset + l2.size - c.offset;
          S.warn(
            `Read video samples time cost: ${Math.round(o2)}ms, file chunk size: ${h}`
          );
        }
        if (t.state === "closed") return;
        this.#s = r[0]?.duration ?? 0, V3(t, r, {
          onDecodingError: (c) => {
            if (this.#a)
              throw c;
            this.#o === 0 && (this.#a = true, S.warn("Downgrade to software decode"), this.#h());
          }
        }), this.#l += r.length;
      }
    }
    this.#r = e, this.#u = false;
  };
  #h = (t) => {
    if (this.#u = false, this.#i.forEach((i2) => i2.close()), this.#i = [], t == null || t === 0)
      this.#r = 0;
    else {
      let i2 = 0;
      for (let n2 = 0; n2 < this.samples.length; n2++) {
        const a = this.samples[n2];
        if (a.is_idr && (i2 = n2), !(a.cts < t)) {
          this.#r = i2;
          break;
        }
      }
    }
    this.#l = 0, this.#o = 0, this.#t?.state !== "closed" && this.#t?.close();
    const e = {
      ...this.conf,
      ...this.#a ? { hardwareAcceleration: "prefer-software" } : {}
    };
    this.#t = new VideoDecoder({
      output: (i2) => {
        if (this.#o += 1, i2.timestamp === -1) {
          i2.close();
          return;
        }
        let n2 = i2;
        i2.duration == null && (n2 = new VideoFrame(i2, {
          duration: this.#s
        }), i2.close()), this.#i.push(n2);
      },
      error: (i2) => {
        if (i2.message.includes("Codec reclaimed due to inactivity")) {
          this.#t = null, S.warn(i2.message);
          return;
        }
        const n2 = `VideoFinder VideoDecoder err: ${i2.message}, config: ${JSON.stringify(e)}, state: ${JSON.stringify(this.#p())}`;
        throw S.error(n2), Error(n2);
      }
    }), this.#t.configure(e);
  };
  #p = () => ({
    time: this.#n,
    decState: this.#t?.state,
    decQSize: this.#t?.decodeQueueSize,
    decCusorIdx: this.#r,
    sampleLen: this.samples.length,
    inputCnt: this.#l,
    outputCnt: this.#o,
    cacheFrameLen: this.#i.length,
    softDeocde: this.#a,
    clipIdCnt: X2,
    sleepCnt: this.#c,
    memInfo: at()
  });
  destroy = () => {
    this.#t?.state !== "closed" && this.#t?.close(), this.#t = null, this.#e.abort = true, this.#i.forEach((t) => t.close()), this.#i = [], this.localFileReader.close();
  };
};
function Nt(s, t) {
  for (let e = 0; e < t.length; e++) {
    const i2 = t[e];
    if (s >= i2.cts && s < i2.cts + i2.duration)
      return e;
    if (i2.cts > s) break;
  }
  return 0;
}
var $t = class {
  constructor(t, e, i2, n2) {
    this.localFileReader = t, this.samples = e, this.conf = i2, this.#t = n2.volume, this.#n = n2.targetSampleRate;
  }
  #t = 1;
  #n;
  #e = null;
  #s = { abort: false, st: performance.now() };
  find = async (t) => {
    const e = t <= this.#a || t - this.#a > 1e5;
    (this.#e == null || this.#e.state === "closed" || e) && this.#d(), e && (this.#a = t, this.#r = Nt(t, this.samples)), this.#s.abort = true;
    const i2 = t - this.#a;
    this.#a = t, this.#s = { abort: false, st: performance.now() };
    const n2 = await this.#l(
      Math.ceil(i2 * (this.#n / 1e6)),
      this.#e,
      this.#s
    );
    return this.#o = 0, n2;
  };
  #a = 0;
  #r = 0;
  #i = {
    frameCnt: 0,
    data: []
  };
  #o = 0;
  #l = async (t, e = null, i2) => {
    if (e == null || i2.abort || e.state === "closed" || t === 0)
      return [];
    const n2 = this.#i.frameCnt - t;
    if (n2 > 0)
      return n2 < x2.sampleRate / 10 && this.#c(e), K2(this.#i, t);
    if (e.decoding) {
      if (performance.now() - i2.st > 3e3)
        throw i2.abort = true, Error(
          `MP4Clip.tick audio timeout, ${JSON.stringify(this.#m())}`
        );
      this.#o += 1, await H2(15);
    } else {
      if (this.#r >= this.samples.length - 1)
        return K2(this.#i, this.#i.frameCnt);
      this.#c(e);
    }
    return this.#l(t, e, i2);
  };
  #c = (t) => {
    if (t.decodeQueueSize > 10) return;
    const i2 = [];
    let n2 = this.#r;
    for (; n2 < this.samples.length; ) {
      const a = this.samples[n2];
      if (n2 += 1, !a.deleted && (i2.push(a), i2.length >= 10))
        break;
    }
    this.#r = n2, t.decode(
      i2.map(
        (a) => new EncodedAudioChunk({
          type: "key",
          timestamp: a.cts,
          duration: a.duration,
          data: a.data
        })
      )
    );
  };
  #d = () => {
    this.#a = 0, this.#r = 0, this.#i = {
      frameCnt: 0,
      data: []
    }, this.#e?.close(), this.#e = Ht(
      this.conf,
      {
        resampleRate: x2.sampleRate,
        volume: this.#t
      },
      (t) => {
        this.#i.data.push(t), this.#i.frameCnt += t[0].length;
      }
    );
  };
  #m = () => ({
    time: this.#a,
    decState: this.#e?.state,
    decQSize: this.#e?.decodeQueueSize,
    decCusorIdx: this.#r,
    sampleLen: this.samples.length,
    pcmLen: this.#i.frameCnt,
    clipIdCnt: X2,
    sleepCnt: this.#o,
    memInfo: at()
  });
  destroy = () => {
    this.#e = null, this.#s.abort = true, this.#i = {
      frameCnt: 0,
      data: []
    }, this.localFileReader.close();
  };
};
function Ht(s, t, e) {
  let i2 = 0, n2 = 0;
  const a = (h) => {
    if (n2 += 1, h.length !== 0) {
      if (t.volume !== 1)
        for (const u2 of h)
          for (let d2 = 0; d2 < u2.length; d2++) u2[d2] *= t.volume;
      h.length === 1 && (h = [h[0], h[0]]), e(h);
    }
  }, r = Wt(a), o2 = t.resampleRate !== s.sampleRate;
  let c = new AudioDecoder({
    output: (h) => {
      const u2 = et(h);
      o2 ? r(
        () => Pt(u2, h.sampleRate, {
          rate: t.resampleRate,
          chanCount: h.numberOfChannels
        })
      ) : a(u2), h.close();
    },
    error: (h) => {
      h.message.includes("Codec reclaimed due to inactivity") || l2("MP4Clip AudioDecoder err", h);
    }
  });
  c.configure(s);
  function l2(h, u2) {
    const d2 = `${h}: ${u2.message}, state: ${JSON.stringify(
      {
        qSize: c.decodeQueueSize,
        state: c.state,
        inputCnt: i2,
        outputCnt: n2
      }
    )}`;
    throw S.error(d2), Error(d2);
  }
  return {
    decode(h) {
      i2 += h.length;
      try {
        for (const u2 of h) c.decode(u2);
      } catch (u2) {
        l2("decode audio chunk error", u2);
      }
    },
    close() {
      c.state !== "closed" && c.close();
    },
    get decoding() {
      return i2 > n2 && c.decodeQueueSize > 0;
    },
    get state() {
      return c.state;
    },
    get decodeQueueSize() {
      return c.decodeQueueSize;
    }
  };
}
function Wt(s) {
  const t = [];
  let e = 0;
  function i2(r, o2) {
    t[o2] = r, n2();
  }
  function n2() {
    const r = t[e];
    r != null && (s(r), e += 1, n2());
  }
  let a = 0;
  return (r) => {
    const o2 = a;
    a += 1, r().then((c) => i2(c, o2)).catch((c) => i2(c, o2));
  };
}
function K2(s, t) {
  const e = [new Float32Array(t), new Float32Array(t)];
  let i2 = 0, n2 = 0;
  for (; n2 < s.data.length; ) {
    const [a, r] = s.data[n2];
    if (i2 + a.length > t) {
      const o2 = t - i2;
      e[0].set(a.subarray(0, o2), i2), e[1].set(r.subarray(0, o2), i2), s.data[n2][0] = a.subarray(o2, a.length), s.data[n2][1] = r.subarray(o2, r.length);
      break;
    } else
      e[0].set(a, i2), e[1].set(r, i2), i2 += a.length, n2++;
  }
  return s.data = s.data.slice(n2), s.frameCnt -= t, e;
}
async function st(s, t) {
  const e = s[0], i2 = s.at(-1);
  if (i2 == null) return [];
  const n2 = i2.offset + i2.size - e.offset;
  if (n2 < 3e7) {
    const a = new Uint8Array(
      await t.read(n2, { at: e.offset })
    );
    return s.map((r) => {
      const o2 = r.offset - e.offset;
      return new EncodedVideoChunk({
        type: r.is_sync ? "key" : "delta",
        timestamp: r.cts,
        duration: r.duration,
        data: a.subarray(o2, o2 + r.size)
      });
    });
  }
  return await Promise.all(
    s.map(async (a) => new EncodedVideoChunk({
      type: a.is_sync ? "key" : "delta",
      timestamp: a.cts,
      duration: a.duration,
      data: await t.read(a.size, {
        at: a.offset
      })
    }))
  );
}
function Xt(s, t, e) {
  const i2 = new OffscreenCanvas(s, t), n2 = i2.getContext("2d");
  return async (a) => (n2.drawImage(a, 0, 0, s, t), a.close(), await i2.convertToBlob(e));
}
function Yt(s, t) {
  if (s.length === 0) return [];
  let e = 0, i2 = 0, n2 = -1;
  for (let c = 0; c < s.length; c++) {
    const l2 = s[c];
    if (n2 === -1 && t < l2.cts && (n2 = c - 1), l2.is_idr)
      if (n2 === -1)
        e = c;
      else {
        i2 = c;
        break;
      }
  }
  const a = s[n2];
  if (a == null) throw Error("Not found video sample by time");
  const r = s.slice(0, i2 === 0 ? s.length : i2).map((c) => ({ ...c }));
  for (let c = e; c < r.length; c++) {
    const l2 = r[c];
    t < l2.cts && (l2.deleted = true, l2.cts = -1);
  }
  L3(r);
  const o2 = s.slice(a.is_idr ? n2 : e).map((c) => ({ ...c, cts: c.cts - t }));
  for (const c of o2)
    c.cts < 0 && (c.deleted = true, c.cts = -1);
  return L3(o2), [r, o2];
}
function Gt(s, t) {
  if (s.length === 0) return [void 0, void 0];
  if (s[0].cts >= t)
    return [void 0, s.map((r) => ({ ...r }))];
  if (s[s.length - 1].cts < t)
    return [s.map((r) => ({ ...r })), void 0];
  let i2 = -1;
  for (let r = 0; r < s.length; r++) {
    const o2 = s[r];
    if (!(t > o2.cts)) {
      i2 = r;
      break;
    }
  }
  if (i2 === -1) throw Error("Not found audio sample by time");
  const n2 = s.slice(0, i2).map((r) => ({ ...r })), a = s.slice(i2).map((r) => ({ ...r, cts: r.cts - t }));
  return [n2, a];
}
function V3(s, t, e) {
  if (s.state === "configured") {
    for (let i2 = 0; i2 < t.length; i2++) s.decode(t[i2]);
    s.flush().catch((i2) => {
      if (!(i2 instanceof Error)) throw i2;
      if (i2.message.includes("Decoding error") && e.onDecodingError != null) {
        e.onDecodingError(i2);
        return;
      }
      if (!i2.message.includes("Aborted due to close"))
        throw i2;
    });
  }
}
function jt(s, t) {
  if (t !== "avc1" && t !== "hvc1") return 0;
  const e = new DataView(s.buffer);
  for (let i2 = 0; i2 < s.byteLength - 4; ) {
    if (t === "avc1") {
      const n2 = e.getUint8(i2 + 4) & 31;
      if (n2 === 5 || n2 === 7 || n2 === 8) return i2;
    } else if (t === "hvc1") {
      const n2 = e.getUint8(i2 + 4) >> 1 & 63;
      if (n2 === 19 || n2 === 20 || n2 === 32 || n2 === 33 || n2 === 34)
        return i2;
    }
    i2 += e.getUint32(i2) + 4;
  }
  return -1;
}
async function Jt(s, t, e, i2, n2, a) {
  const r = await t.createReader(), o2 = await st(
    s.filter(
      (h) => !h.deleted && h.is_sync && h.cts >= n2.start && h.cts <= n2.end
    ),
    r
  );
  if (o2.length === 0 || i2.aborted) {
    a(null, true);
    return;
  }
  let c = 0;
  V3(l2(), o2, {
    onDecodingError: (h) => {
      S.warn("thumbnailsByKeyFrame", h), c === 0 ? V3(l2(true), o2, {
        onDecodingError: (u2) => {
          r.close(), S.error("thumbnailsByKeyFrame retry soft deocde", u2);
        }
      }) : (a(null, true), r.close());
    }
  });
  function l2(h = false) {
    const u2 = {
      ...e,
      ...h ? { hardwareAcceleration: "prefer-software" } : {}
    }, d2 = new VideoDecoder({
      output: (y2) => {
        c += 1;
        const m2 = c === o2.length;
        a(y2, m2), m2 && (r.close(), d2.state !== "closed" && d2.close());
      },
      error: (y2) => {
        const m2 = `thumbnails decoder error: ${y2.message}, config: ${JSON.stringify(u2)}, state: ${JSON.stringify(
          {
            qSize: d2.decodeQueueSize,
            state: d2.state,
            outputCnt: c,
            inputCnt: o2.length
          }
        )}`;
        throw S.error(m2), Error(m2);
      }
    });
    return i2.addEventListener("abort", () => {
      r.close(), d2.state !== "closed" && d2.close();
    }), d2.configure(u2), d2;
  }
}
function L3(s) {
  let t = 0, e = null;
  for (const i2 of s)
    if (!i2.deleted) {
      if (i2.is_sync && (t += 1), t >= 2) break;
      (e == null || i2.cts < e.cts) && (e = i2);
    }
  e != null && e.cts < 2e5 && (e.duration += e.cts, e.cts = 0);
}
function at() {
  try {
    const s = performance.memory;
    return {
      jsHeapSizeLimit: s.jsHeapSizeLimit,
      totalJSHeapSize: s.totalJSHeapSize,
      usedJSHeapSize: s.usedJSHeapSize,
      percentUsed: (s.usedJSHeapSize / s.jsHeapSizeLimit).toFixed(3),
      percentTotal: (s.totalJSHeapSize / s.jsHeapSizeLimit).toFixed(3)
    };
  } catch {
    return {};
  }
}

// ../preview-engine/src/keyframeIndex.ts
var MP4BoxNS = __toESM(require_mp4box_all(), 1);
var MP4Box = MP4BoxNS.default ?? MP4BoxNS;
function buildIndex(keyframeTimesUs) {
  const times = [...keyframeTimesUs].sort((a, b) => a - b);
  function nearestAtOrBefore(targetUs) {
    if (times.length === 0) return 0;
    let lo = 0;
    let hi = times.length - 1;
    if (targetUs < times[0]) return times[0];
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (times[mid] <= targetUs) lo = mid;
      else hi = mid - 1;
    }
    return times[lo];
  }
  function nearest(targetUs) {
    if (times.length === 0) return 0;
    const before = nearestAtOrBefore(targetUs);
    const idx = times.indexOf(before);
    const after = idx + 1 < times.length ? times[idx + 1] : before;
    return Math.abs(after - targetUs) < Math.abs(targetUs - before) ? after : before;
  }
  function withinTolerance(targetUs, toleranceUs) {
    const n2 = nearest(targetUs);
    return Math.abs(n2 - targetUs) <= toleranceUs ? n2 : null;
  }
  return { keyframeTimesUs: times, nearestAtOrBefore, nearest, withinTolerance };
}
async function buildKeyframeIndexFromHeader(headerBin) {
  return new Promise((resolve, reject) => {
    try {
      const file = MP4Box.createFile();
      file.onError = (e) => reject(new Error(`mp4box parse error: ${e}`));
      file.onReady = (info) => {
        try {
          const videoTrack = info.videoTracks[0];
          if (!videoTrack) {
            resolve(buildIndex([]));
            return;
          }
          const samples = file.getTrackSamplesInfo(videoTrack.id);
          if (samples.length === 0) {
            resolve(buildIndex([]));
            return;
          }
          const t0 = samples[0].dts;
          const keyframeTimesUs = samples.filter((s) => s.is_sync).map((s) => (s.cts - t0) / s.timescale * 1e6);
          resolve(buildIndex(keyframeTimesUs));
        } catch (e) {
          reject(e);
        }
      };
      const buf = headerBin;
      buf.fileStart = 0;
      file.appendBuffer(buf);
      file.flush();
    } catch (e) {
      reject(e);
    }
  });
}

// ../preview-engine/src/guard.ts
var TimeoutError = class extends Error {
  constructor(label, ms) {
    super(`timeout: ${label} exceeded ${ms}ms`);
    this.name = "TimeoutError";
  }
};
async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_3, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
var DECODER_ERROR_PATTERNS = [
  /Unsupported configuration/i,
  /AudioDecoder err/i,
  /VideoDecoder err/i,
  /VideoFinder VideoDecoder/i,
  /decode.*error/i
];
function looksLikeDecoderError(message) {
  return DECODER_ERROR_PATTERNS.some((re) => re.test(message));
}
function watchDecoderErrors(onDetect) {
  const errorHandler = (e) => {
    const msg = e.message ?? String(e.error ?? e);
    if (looksLikeDecoderError(msg)) {
      onDetect(msg);
      e.preventDefault();
    }
  };
  const rejectionHandler = (e) => {
    const msg = e.reason && e.reason.message ? e.reason.message : String(e.reason);
    if (looksLikeDecoderError(msg)) {
      onDetect(msg);
      e.preventDefault();
    }
  };
  window.addEventListener("error", errorHandler);
  window.addEventListener("unhandledrejection", rejectionHandler);
  return () => {
    window.removeEventListener("error", errorHandler);
    window.removeEventListener("unhandledrejection", rejectionHandler);
  };
}

// ../preview-engine/src/clipSession.ts
var ClipSession = class {
  id;
  src;
  meta = null;
  state = "idle";
  clip = null;
  keyframeIndex = null;
  /** 末尾 GOP 安全マージンの実効上限(us)。末尾がキーフレームで閉じられていない
   *  最終 GOP 全域が flush 時に壊れる問題（w3c/webcodecs#116 系。実測で「最終フレームだけでなく
   *  最終 GOP まるごと」壊れることを確認）に対応するため、固定フレーム数ではなく
   *  「最後から2番目のキーフレーム未満」を安全圏として使う。キーフレーム情報が無ければ
   *  opts.tailMarginUs（固定マイクロ秒）にフォールバックする。 */
  tailSafeLimitUs = null;
  tailWarningEmitted = false;
  /** foreground（tickExact/tickApprox）要求のたび進む世代番号。tickBackground の陳腐判定に使う */
  foregroundGeneration = 0;
  opts;
  onWarning;
  loadPromise = null;
  // 重要な安全策: av-cliper 1.2.8 の MP4Clip 内部実装を読み取ったところ、tick() は
  // 「後方 or 同時刻の要求」で同期的にデコーダをリセットしてから非同期に歩く実装になっている。
  // 同一 MP4Clip インスタンスへ tick() を並行に呼ぶと、この同期リセットと非同期歩行が競合し
  // 内部状態（読み取りカーソル・デコーダキュー）が壊れうる。呼び出し元（scrub/exact/prefetch/
  // warmup）がどこから来ても必ず直列化するため、セッション内に単純な FIFO キューを持つ。
  tickQueue = Promise.resolve();
  serialize(fn) {
    const run = this.tickQueue.then(fn, fn);
    this.tickQueue = run.then(
      () => void 0,
      () => void 0
    );
    return run;
  }
  constructor(id, src, opts, onWarning) {
    this.id = id;
    this.src = src;
    this.opts = opts;
    this.onWarning = onWarning;
  }
  /** 冪等: 既に load 中/済みなら同じ promise を返す */
  load() {
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.doLoad();
    return this.loadPromise;
  }
  async doLoad() {
    this.state = "loading";
    const attempts = [
      { audio: true, hw: "prefer-hardware", resultState: "ready" },
      { audio: false, hw: "prefer-hardware", resultState: "ready" },
      { audio: false, hw: "prefer-software", resultState: "degraded" }
    ];
    let lastError = null;
    for (let i2 = 0; i2 < attempts.length; i2++) {
      const attempt = attempts[i2];
      try {
        const { clip, meta } = await this.attemptLoad(attempt.audio, attempt.hw);
        this.clip = clip;
        this.meta = meta;
        this.state = attempt.resultState;
        if (attempt.resultState === "degraded") {
          this.onWarning({
            kind: "hwDecoderDegraded",
            clipId: this.id,
            message: `software decode fallback active (attempt ${i2 + 1}/${attempts.length})`
          });
        }
        try {
          const header = await withTimeout(clip.getFileHeaderBinData(), 2e3, `header ${this.id}`);
          this.keyframeIndex = await withTimeout(
            buildKeyframeIndexFromHeader(header),
            2e3,
            `keyframeIndex ${this.id}`
          );
          const kf = this.keyframeIndex.keyframeTimesUs;
          if (kf.length >= 2) {
            this.tailSafeLimitUs = kf[kf.length - 1] - 1e6;
          }
        } catch (e) {
          this.onWarning({
            kind: "decodeTimeout",
            clipId: this.id,
            message: `keyframe index build failed, falling back to exact-only scrub: ${String(e)}`
          });
        }
        return;
      } catch (e) {
        lastError = e;
        const isLastAttempt = i2 === attempts.length - 1;
        this.onWarning({
          kind: i2 === 0 ? "audioDecoderFallback" : "hwDecoderDegraded",
          clipId: this.id,
          message: `load attempt ${i2 + 1}/${attempts.length} failed (${String(e)})${isLastAttempt ? "" : " \u2014 retrying with degraded config"}`,
          detail: String(e)
        });
      }
    }
    this.state = "unavailable";
    this.onWarning({
      kind: "clipUnavailable",
      clipId: this.id,
      message: `all load fallbacks exhausted: ${String(lastError)}`,
      detail: String(lastError)
    });
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
  async attemptLoad(audio, hw) {
    const res = await fetch(this.src);
    if (!res.ok || !res.body) throw new Error(`fetch failed: ${this.src} status=${res.status}`);
    const clip = new I2(res.body, { audio, __unsafe_hardwareAcceleration__: hw });
    let signalError = null;
    const errorSignal = new Promise((_3, reject) => {
      signalError = (msg) => reject(new Error(`decoder error: ${msg}`));
    });
    errorSignal.catch(() => {
    });
    const stopWatch = watchDecoderErrors((msg) => signalError?.(msg));
    try {
      await withTimeout(Promise.race([clip.ready, errorSignal]), this.opts.loadTimeoutMs, `ready ${this.id}`);
      const meta = clip.meta;
      const primed = await withTimeout(
        Promise.race([clip.tick(0), errorSignal]),
        this.opts.tickTimeoutMs,
        `prime-tick ${this.id}`
      );
      primed.video?.close();
      return { clip, meta };
    } catch (e) {
      clip.destroy();
      throw e;
    } finally {
      stopWatch();
    }
  }
  /** 厳密解決（release / programmatic exact seek）。末尾 GOP 安全マージンを常に適用 */
  async tickExact(sourceTimeUs) {
    this.foregroundGeneration += 1;
    return this.rawTick(sourceTimeUs, false);
  }
  /** tolerance スクラブ用の近似解決。キーフレームへスナップしてから tick() する（E1） */
  async tickApprox(sourceTimeUs, toleranceUs, snapBeyondTolerance) {
    this.foregroundGeneration += 1;
    if (!this.keyframeIndex || this.keyframeIndex.keyframeTimesUs.length === 0) {
      return this.rawTick(sourceTimeUs, false);
    }
    const within = this.keyframeIndex.withinTolerance(sourceTimeUs, toleranceUs);
    if (within != null) {
      return this.rawTick(within, true);
    }
    if (snapBeyondTolerance) {
      const nearest = this.keyframeIndex.nearestAtOrBefore(sourceTimeUs);
      return this.rawTick(nearest, true);
    }
    return this.rawTick(sourceTimeUs, false);
  }
  /** 診断/計測用。E1 のキーフレームスナップ・E4 の末尾マージン計算の検証に使う */
  getKeyframeTimesUs() {
    return this.keyframeIndex?.keyframeTimesUs ?? null;
  }
  /**
   * E2 先読み専用の背景 tick。foreground（tickExact/tickApprox/warmup）の要求が
   * 割り込んだら、自分の番が来た時点で実際のデコードをスキップして即終了する
   * （直列キューが背景タスクで詰まり、foreground のレイテンシが悪化するのを防ぐ —
   * 実測で発見した回帰。バックグラウンド側にキャンセル手段が無い WebCodecs/MP4Clip では
   * 「自分の番が来たら鮮度を再確認する」協調的な形でしか優先度を模擬できない）。
   */
  async tickBackground(sourceTimeUs) {
    const capturedGeneration = this.foregroundGeneration;
    return this.rawTick(sourceTimeUs, false, () => this.foregroundGeneration !== capturedGeneration);
  }
  async rawTick(sourceTimeUs, approx, staleCheck) {
    if (this.state === "unavailable" || !this.clip) return { tickMs: 0, approx };
    let target = Math.max(0, sourceTimeUs);
    const duration = this.meta?.duration ?? Infinity;
    const fallbackLimit = duration - this.opts.tailMarginUs;
    const safeLimit = this.tailSafeLimitUs != null ? Math.min(this.tailSafeLimitUs, fallbackLimit) : fallbackLimit;
    if (target > safeLimit) {
      const clamped = Math.max(0, safeLimit);
      if (clamped !== target) {
        target = clamped;
        if (!this.tailWarningEmitted) {
          this.tailWarningEmitted = true;
          this.onWarning({
            kind: "tailGopMarginClamped",
            clipId: this.id,
            message: this.tailSafeLimitUs != null ? `seek near clip end clamped below final (unclosed) GOP's keyframe at ${this.tailSafeLimitUs}us (w3c/webcodecs#116 defense; whole final GOP observed broken, not just last frame)` : `seek near clip end clamped to duration-${this.opts.tailMarginUs}us (w3c/webcodecs#116 defense, no keyframe index available)`
          });
        }
      }
    }
    const t0 = performance.now();
    try {
      const ret2 = await this.serialize(() => {
        if (staleCheck?.()) return Promise.resolve({});
        return withTimeout(this.clip.tick(Math.floor(target)), this.opts.tickTimeoutMs, `tick ${this.id}`);
      });
      return { video: ret2.video, tickMs: performance.now() - t0, approx };
    } catch (e) {
      this.onWarning({
        kind: "decodeTimeout",
        clipId: this.id,
        message: `tick timed out/errored at t=${target}us: ${String(e)}`
      });
      return { tickMs: performance.now() - t0, approx };
    }
  }
  /**
   * E3 warmup: 次クリップのデコーダを事前 configure + prime する。
   *
   * 重要な実装上の発見: av-cliper の MP4Clip.tick() は「要求時刻が直前の要求時刻以下」なら
   * 同一時刻の再要求であっても無条件にデコーダをフルリセットする実装になっている
   * （後方シークと区別しない）。そのため実際に必要な開始時刻ちょうどをここで prime すると、
   * 本番の tick が「全く同じ時刻の再要求」になり `t <= lastRequested` を満たして
   * **もう一度リセットが起きてしまい warmup が無駄になる**（実測で発見。1フレーム前を
   * prime するよう変更したところ改善した）。そのため実際の開始時刻より 1 フレーム分手前を
   * prime し、本番の tick が「わずかに前方への継続」（reset ではなく歩行）になるようにする。
   */
  async warmup(nearStartUs, frameDurationUs = 1e6 / 30) {
    const t0 = performance.now();
    await this.load();
    if (this.clip) {
      const primeUs = Math.max(0, nearStartUs - Math.round(frameDurationUs));
      const ret2 = await this.tickExact(primeUs);
      ret2.video?.close();
    }
    return performance.now() - t0;
  }
  destroy() {
    this.clip?.destroy();
    this.clip = null;
    this.state = "idle";
  }
};

// ../preview-engine/src/lookaheadCache.ts
var LookaheadCache = class {
  capacity;
  map = /* @__PURE__ */ new Map();
  // key: frame number, insertion順=LRU順
  constructor(capacity) {
    this.capacity = Math.max(1, capacity);
  }
  get(frameNumber) {
    const hit = this.map.get(frameNumber);
    if (!hit) return null;
    this.map.delete(frameNumber);
    this.map.set(frameNumber, hit);
    return hit;
  }
  /** clone を返す（呼び出し側が close() してよい）。ヒットしなければ null */
  getClone(frameNumber) {
    const hit = this.get(frameNumber);
    if (!hit) return null;
    return { frame: hit.frame.clone(), tickMs: hit.tickMs };
  }
  put(frameNumber, frame, tickMs) {
    const existing = this.map.get(frameNumber);
    if (existing) existing.frame.close();
    this.map.set(frameNumber, { frame, tickMs });
    while (this.map.size > this.capacity) {
      const oldestKey = this.map.keys().next().value;
      if (oldestKey == null) break;
      const entry = this.map.get(oldestKey);
      entry?.frame.close();
      this.map.delete(oldestKey);
    }
  }
  has(frameNumber) {
    return this.map.has(frameNumber);
  }
  get size() {
    return this.map.size;
  }
  clear() {
    for (const entry of this.map.values()) entry.frame.close();
    this.map.clear();
  }
};

// ../preview-engine/src/scrubController.ts
var ScrubController = class {
  throttleMs;
  executor;
  lastDispatchAt = -Infinity;
  pendingFrame = null;
  throttleTimer = null;
  generation = 0;
  // 重要: 下層の MP4Clip.tick() は同一インスタンスへの並行呼び出しを想定していない
  // （内部状態を同期的にリセットしてから非同期に歩くため、並行実行すると内部状態が壊れうる —
  // 実測で発見。clipSession.ts のコメント参照）。そのため「保留は最新1件のみ」に加えて
  // 「実行中は新規ディスパッチしない（完了後にまとめて最新へ進む）」を徹底する。
  executing = false;
  constructor(throttleMs, executor) {
    this.throttleMs = throttleMs;
    this.executor = executor;
  }
  /** ドラッグ中の新しい目標フレーム。保留は最新1件のみに上書きされる */
  requestScrub(frame) {
    this.pendingFrame = frame;
    this.scheduleFlushIfNeeded();
  }
  scheduleFlushIfNeeded() {
    if (this.executing) return;
    if (this.throttleTimer != null) return;
    const elapsed = performance.now() - this.lastDispatchAt;
    const delay = Math.max(0, this.throttleMs - elapsed);
    this.throttleTimer = setTimeout(() => this.flush(), delay);
  }
  flush() {
    this.throttleTimer = null;
    if (this.pendingFrame == null || this.executing) return;
    const frame = this.pendingFrame;
    this.pendingFrame = null;
    this.lastDispatchAt = performance.now();
    this.generation += 1;
    const gen = this.generation;
    this.executing = true;
    void this.executor(frame, gen).finally(() => {
      this.executing = false;
      if (this.pendingFrame != null) this.scheduleFlushIfNeeded();
    });
  }
  /** executor 側が「自分の実行結果はもう陳腐か」を確認するために呼ぶ */
  isStale(generation) {
    return generation !== this.generation;
  }
  currentGeneration() {
    return this.generation;
  }
  /** リリース/exact シーク時など、保留中の近似シークを破棄する */
  cancelPending() {
    this.pendingFrame = null;
    if (this.throttleTimer != null) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.generation += 1;
  }
  dispose() {
    this.cancelPending();
  }
};

// ../preview-engine/src/warmupManager.ts
var WarmupManager = class {
  leadInSec;
  warmedClipIds = /* @__PURE__ */ new Set();
  inFlight = /* @__PURE__ */ new Map();
  constructor(leadInSec) {
    this.leadInSec = leadInSec;
  }
  /** 毎フレーム/毎シークで呼ぶ。境界が近ければウォームアップを起動する（冪等・多重発火防止） */
  maybeWarmup(secondsToBoundary, nextClipSession, nextClipSourceInUs, onWarmed, frameDurationUs = 1e6 / 30) {
    if (secondsToBoundary == null || nextClipSession == null) return;
    if (secondsToBoundary > this.leadInSec) return;
    if (this.warmedClipIds.has(nextClipSession.id) || this.inFlight.has(nextClipSession.id)) return;
    const p2 = nextClipSession.warmup(nextClipSourceInUs, frameDurationUs);
    this.inFlight.set(nextClipSession.id, p2);
    void p2.then((tookMs) => {
      this.warmedClipIds.add(nextClipSession.id);
      this.inFlight.delete(nextClipSession.id);
      onWarmed(nextClipSession.id, tookMs);
    });
  }
  /** クリップが実際に切り替わったら呼ぶ（次の境界に向けて再びウォームアップ可能にする） */
  notifyClipChanged(currentClipId) {
    this.warmedClipIds.delete(currentClipId);
  }
  reset() {
    this.warmedClipIds.clear();
    this.inFlight.clear();
  }
};

// ../preview-engine/src/thumbnailTrack.ts
var ThumbnailTrack = class {
  entries = [];
  buildPromise = null;
  generation = 0;
  opts;
  constructor(options) {
    this.opts = {
      maxThumbnails: Math.max(1, Math.floor(options.maxThumbnails)),
      intervalSec: Math.max(0.1, options.intervalSec),
      thumbWidth: Math.max(1, Math.floor(options.thumbWidth))
    };
  }
  isReady() {
    return this.entries.length > 0;
  }
  /** 疎なトラックでも動作する、時刻差の絶対値による最近傍二分探索。 */
  nearest(timeUs) {
    if (this.entries.length === 0) return null;
    let lo = 0;
    let hi = this.entries.length;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (this.entries[mid].timeUs < timeUs) lo = mid + 1;
      else hi = mid;
    }
    if (lo === 0) return this.entries[0] ?? null;
    if (lo >= this.entries.length) return this.entries[this.entries.length - 1] ?? null;
    const before = this.entries[lo - 1];
    const after = this.entries[lo];
    return timeUs - before.timeUs <= after.timeUs - timeUs ? before : after;
  }
  /**
   * 冪等かつ best-effort。キーフレーム時刻を優先し、無い場合だけ粗い等間隔へフォールバックする。
   * 生成途中でも entries を公開するため、最初の1枚ができた時点からスクラブ表示に利用できる。
   */
  build(session, sourceStartUs, sourceEndUs, keyframeTimesUs) {
    if (this.buildPromise) return this.buildPromise;
    const generation = this.generation;
    this.buildPromise = this.doBuild(session, sourceStartUs, sourceEndUs, keyframeTimesUs, generation);
    return this.buildPromise;
  }
  clear() {
    this.generation += 1;
    for (const entry of this.entries) entry.bitmap.close();
    this.entries = [];
    this.buildPromise = null;
  }
  async doBuild(session, sourceStartUs, sourceEndUs, keyframeTimesUs, generation) {
    if (!session.meta || !Number.isFinite(sourceStartUs) || !Number.isFinite(sourceEndUs)) return;
    const boundedStartUs = Math.max(0, sourceStartUs);
    const boundedEndUs = Math.min(session.meta.duration, sourceEndUs);
    if (boundedEndUs <= boundedStartUs) return;
    const sampleTimes = this.sampleTimes(boundedStartUs, boundedEndUs, keyframeTimesUs);
    if (sampleTimes.length === 0) return;
    const width = this.opts.thumbWidth;
    const height = Math.max(1, Math.round(width * (session.meta.height / Math.max(1, session.meta.width))));
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    for (const timeUs of sampleTimes) {
      if (generation !== this.generation) return;
      const ret2 = await session.tickBackground(timeUs);
      const video = ret2.video;
      if (!video) continue;
      try {
        ctx.drawImage(video, 0, 0, width, height);
      } finally {
        video.close();
      }
      const bitmap = await createImageBitmap(canvas);
      if (generation !== this.generation) {
        bitmap.close();
        return;
      }
      this.entries.push({ timeUs, bitmap });
    }
  }
  sampleTimes(sourceStartUs, sourceEndUs, keyframeTimesUs) {
    const validKeyframes = [...new Set(keyframeTimesUs ?? [])].filter((timeUs) => Number.isFinite(timeUs) && timeUs >= sourceStartUs && timeUs < sourceEndUs).sort((a, b) => a - b);
    if (validKeyframes.length > 0) return this.limitEvenly(validKeyframes);
    const intervalUs = this.opts.intervalSec * 1e6;
    const fallback = [];
    for (let timeUs = Math.ceil(sourceStartUs); timeUs < sourceEndUs; timeUs += intervalUs) {
      fallback.push(Math.floor(timeUs));
    }
    return this.limitEvenly(fallback);
  }
  limitEvenly(times) {
    if (times.length <= this.opts.maxThumbnails) return times;
    if (this.opts.maxThumbnails === 1) return [times[0]];
    const selected = [];
    for (let i2 = 0; i2 < this.opts.maxThumbnails; i2++) {
      const index = Math.round(i2 * (times.length - 1) / (this.opts.maxThumbnails - 1));
      const timeUs = times[index];
      if (selected[selected.length - 1] !== timeUs) selected.push(timeUs);
    }
    return selected;
  }
};

// ../preview-engine/src/duckingGain.ts
var AUDIO_GAIN_DB_MIN = -60;
var AUDIO_GAIN_DB_MAX = 12;
var STATIC_DUCK_GAIN_DB = -12;
function clampGainDb(gainDb) {
  const value = gainDb ?? 0;
  if (!Number.isFinite(value)) return null;
  return Math.min(AUDIO_GAIN_DB_MAX, Math.max(AUDIO_GAIN_DB_MIN, value));
}
function dbToLinear(gainDb) {
  return Math.pow(10, gainDb / 20);
}
function computeDuckIntervals(sources) {
  return sources.filter(
    (s) => Number.isFinite(s.t) && s.t >= 0 && Number.isFinite(s.durationSec) && s.durationSec > 0
  ).map((s) => ({ startSec: s.t, endSec: s.t + s.durationSec }));
}
function isWithinDuckInterval(intervals, atSec) {
  return intervals.some((iv) => atSec >= iv.startSec && atSec < iv.endSec);
}
function computeBgmDuckGainDb(intervals, duckingEnabled, atSec) {
  if (!duckingEnabled) return 0;
  return isWithinDuckInterval(intervals, atSec) ? STATIC_DUCK_GAIN_DB : 0;
}

// ../preview-engine/src/narrationValidation.ts
function validateNarrationSpecs(specs, timelineDurationSec) {
  const valid = [];
  const skipped = [];
  for (const spec of specs) {
    if (!Number.isFinite(spec.t) || spec.t < 0) {
      skipped.push({ id: spec.id, reason: `invalid t (non-finite or negative): ${spec.t}` });
      continue;
    }
    if (Number.isFinite(timelineDurationSec) && spec.t >= timelineDurationSec) {
      skipped.push({
        id: spec.id,
        reason: `t (${spec.t}s) is at/beyond timeline duration (${timelineDurationSec}s)`
      });
      continue;
    }
    const gainDb = clampGainDb(spec.gainDb);
    if (gainDb == null) {
      skipped.push({ id: spec.id, reason: `non-finite gain_db: ${spec.gainDb}` });
      continue;
    }
    valid.push({ id: spec.id, src: spec.src, t: spec.t, gainDb });
  }
  return { valid, skipped };
}

// ../preview-engine/src/narrationTrack.ts
var NarrationTrack = class {
  constructor(ctx, opts = {}) {
    this.ctx = ctx;
    this.opts = opts;
  }
  events = [];
  activeSources = [];
  /** 現在保持している（デコード成功済みの）narration イベント一覧 */
  getEvents() {
    return this.events;
  }
  /** bgm.ducking 判定に使う区間一覧（duckingGain.ts 参照） */
  getDuckIntervals() {
    return computeDuckIntervals(this.events.map((e) => ({ t: e.t, durationSec: e.durationSec })));
  }
  /**
   * narration 仕様群を検証・fetch・デコードして内部に保持する。
   * 個別要素が読めない/壊れている場合はその要素だけをスキップし（契約 §4）、
   * console 警告 + onWarning コールバック（EngineWarningEvent 'narrationUnavailable'）の両方で通知する。
   * プレビュー全体（他の narration・映像）は継続する。
   */
  async load(specs, timelineDurationSec, onWarning) {
    const { valid, skipped } = validateNarrationSpecs(specs, timelineDurationSec);
    for (const s of skipped) {
      const message = `narration ${s.id} skipped: ${s.reason}`;
      console.warn(`[preview-engine] ${message}`);
      onWarning({ kind: "narrationUnavailable", clipId: s.id, message });
    }
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    for (const spec of valid) {
      try {
        const res = await fetchImpl(spec.src);
        if (!res.ok) throw new Error(`fetch failed: ${spec.src} status=${res.status}`);
        const arrayBuf = await res.arrayBuffer();
        const buffer = await this.ctx.decodeAudioData(arrayBuf);
        this.events.push({ id: spec.id, buffer, t: spec.t, gainDb: spec.gainDb, durationSec: buffer.duration });
      } catch (e) {
        const message = `narration ${spec.id} unavailable (fetch/decode failed): ${String(e)}`;
        console.warn(`[preview-engine] ${message}`);
        onWarning({ kind: "narrationUnavailable", clipId: spec.id, message, detail: e });
      }
    }
  }
  /**
   * startAtSec（タイムライン秒）から再生を開始するよう、保持中の narration イベントをスケジュールする。
   * 呼び出し前に鳴っていた分は stopAll() 相当で止めてから積み直す（play()/シーク時の再スケジュール用）。
   *
   * - t >= startAtSec のイベント: (t - startAtSec) 秒後に頭から開始
   * - t < startAtSec < t+durationSec のイベント（再生位置が narration の途中にシークされた場合）:
   *   即座に、バッファ内オフセット (startAtSec - t) から開始
   * - t + durationSec <= startAtSec のイベント（既に終わっている）: スケジュールしない
   */
  scheduleFrom(startAtSec, contextStartTime, destination) {
    this.stopAll();
    for (const ev of this.events) {
      const endSec = ev.t + ev.durationSec;
      if (endSec <= startAtSec) continue;
      const gainNode = this.ctx.createGain();
      gainNode.gain.value = dbToLinear(ev.gainDb);
      gainNode.connect(destination);
      const source = this.ctx.createBufferSource();
      source.buffer = ev.buffer;
      source.connect(gainNode);
      if (ev.t >= startAtSec) {
        source.start(contextStartTime + (ev.t - startAtSec));
      } else {
        source.start(contextStartTime, startAtSec - ev.t);
      }
      this.activeSources.push({ source, gain: gainNode });
    }
  }
  /** 現在スケジュール/再生中の narration をすべて停止・切断する（pause/seek/dispose 用） */
  stopAll() {
    for (const { source, gain } of this.activeSources) {
      try {
        source.stop();
      } catch {
      }
      source.disconnect();
      gain.disconnect();
    }
    this.activeSources = [];
  }
  dispose() {
    this.stopAll();
    this.events = [];
  }
};

// ../preview-engine/src/engine.ts
var DEFAULT_OPTIONS = {
  scrubThrottleMs: 1e3 / 30,
  keyframeSnapBeyondTolerance: true,
  lookaheadCacheSize: 24,
  warmupLeadInSec: 0.75,
  loadTimeoutMs: 4e3,
  tickTimeoutMs: 4e3,
  tailMarginUs: Math.round(1e6 / 30 * 2),
  enableThumbnailScrub: true,
  thumbnailMaxCount: 40,
  thumbnailIntervalSec: 2,
  thumbnailWidth: 160
};
var PreviewEngine = class {
  emitter = new TypedEmitter();
  timeline = null;
  sessions = /* @__PURE__ */ new Map();
  cache = /* @__PURE__ */ new Map();
  prefetchInFlight = /* @__PURE__ */ new Set();
  thumbnailTracks = /* @__PURE__ */ new Map();
  thumbnailBuildStarted = /* @__PURE__ */ new Set();
  thumbnailSourceRanges = /* @__PURE__ */ new Map();
  lastThumbnailKey = null;
  canvas = null;
  ctx = null;
  scrub;
  warmupMgr;
  currentFrame = 0;
  playing = false;
  renderInFlight = false;
  playHandle = null;
  opts;
  tailMarginUserSet;
  disposed = false;
  // narration 再生（Wave 20 T4）。BGM/SFX 自体のプレビュー再生は本パッケージ未実装のため、
  // audioCtx は narration 専用（README「narration 再生」節 / report.md 参照）。
  audioCtx = null;
  narrationTrack = null;
  audioSpec = null;
  constructor(options = {}) {
    this.tailMarginUserSet = options.tailMarginUs != null;
    this.opts = { ...DEFAULT_OPTIONS, ...options };
    this.scrub = new ScrubController(this.opts.scrubThrottleMs, (frame, gen) => this.executeScrubTick(frame, gen));
    this.warmupMgr = new WarmupManager(this.opts.warmupLeadInSec);
  }
  on(event, cb) {
    return this.emitter.on(event, cb);
  }
  off(event, cb) {
    this.emitter.off(event, cb);
  }
  mount(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
  }
  async loadTimeline(spec) {
    this.disposeSessions();
    this.timeline = new Timeline(spec);
    if (!this.tailMarginUserSet) {
      this.opts.tailMarginUs = Math.round(1e6 / spec.fps * 2);
    }
    for (const clip of spec.clips) {
      this.sessions.set(
        clip.id,
        new ClipSession(
          clip.id,
          clip.src,
          {
            loadTimeoutMs: this.opts.loadTimeoutMs,
            tickTimeoutMs: this.opts.tickTimeoutMs,
            tailMarginUs: this.opts.tailMarginUs
          },
          (w) => this.emitter.emit("warning", w)
        )
      );
      this.cache.set(clip.id, new LookaheadCache(this.opts.lookaheadCacheSize));
      if (this.opts.enableThumbnailScrub) {
        const sourceStartUs = clip.sourceInUs ?? 0;
        const sourceDurationUs = Math.max(0, clip.endFrame - clip.startFrame) / spec.fps * 1e6;
        this.thumbnailSourceRanges.set(clip.id, {
          startUs: sourceStartUs,
          endUs: sourceStartUs + sourceDurationUs
        });
        this.thumbnailTracks.set(
          clip.id,
          new ThumbnailTrack({
            maxThumbnails: this.opts.thumbnailMaxCount,
            intervalSec: this.opts.thumbnailIntervalSec,
            thumbWidth: this.opts.thumbnailWidth
          })
        );
      }
    }
    this.currentFrame = 0;
    const first = this.timeline.resolve(0);
    if (first) {
      const session = this.getSession(first.clip.id);
      await session.load();
      this.startThumbnailBuild(first.clip.id, session);
    }
    this.audioSpec = spec.audio ?? null;
    await this.loadNarration(spec.audio, this.timeline.totalFrames() / spec.fps);
  }
  /**
   * narration 付きプロジェクトなら decode/検証まで済ませておく（play() 時点で await せず
   * 即座にスケジュールできるようにするため）。narration が無ければ何もしない
   * （既存タイムラインの挙動を一切変えない — 契約 §0 の後方互換方針）。
   */
  async loadNarration(audio, timelineDurationSec) {
    if (!audio?.narration || audio.narration.length === 0) return;
    const AudioContextCtor = typeof AudioContext !== "undefined" ? AudioContext : void 0;
    if (!AudioContextCtor) {
      this.emitter.emit("warning", {
        kind: "narrationUnavailable",
        clipId: "narration",
        message: "AudioContext unavailable in this environment; narration playback disabled"
      });
      return;
    }
    this.audioCtx = this.audioCtx ?? new AudioContextCtor();
    const track = new NarrationTrack(this.audioCtx);
    await track.load(audio.narration, timelineDurationSec, (w) => this.emitter.emit("warning", w));
    this.narrationTrack = track;
  }
  /**
   * bgm.ducking:true のときの静的ダッキング近似値(dB)を返す（契約 §3「固定 -12dB」）。
   * narration が無い/その位置がどの narration 区間にも入っていない場合は 0（無効果 = 元のゲインのまま）。
   * BGM 自体の GainNode は本パッケージが管理しない（README 参照）ため、呼び出し側が自前の BGM
   * ゲインにこの値を加算適用する想定の公開ユーティリティ。
   */
  narrationDuckGainDbAt(atSec) {
    if (!this.narrationTrack || !this.audioSpec?.bgm?.ducking) return 0;
    return computeBgmDuckGainDb(this.narrationTrack.getDuckIntervals(), true, atSec);
  }
  /**
   * @param frame タイムラインフレーム番号
   * @param mode 'exact' | 'interactiveScrub'（Palmier 同型の2モード）
   */
  async seek(frame, mode) {
    if (this.disposed || !this.timeline) return;
    if (mode === "interactiveScrub") {
      this.tryDrawThumbnail(frame);
      this.scrub.requestScrub(frame);
      return;
    }
    this.scrub.cancelPending();
    await this.resolveAndRender(frame, false);
    if (this.playing) {
      this.rescheduleNarrationFrom(frame);
    }
  }
  play() {
    if (this.playing || !this.timeline) return;
    this.playing = true;
    const fps = this.timeline.fps;
    const frameMs = 1e3 / fps;
    this.rescheduleNarrationFrom(this.currentFrame);
    let last = performance.now();
    const loop = () => {
      if (!this.playing) return;
      const now = performance.now();
      if (!this.renderInFlight && now - last >= frameMs) {
        last = now;
        const total = this.timeline.totalFrames();
        if (this.currentFrame >= total) {
          this.pause();
          return;
        }
        this.renderInFlight = true;
        void this.resolveAndRender(this.currentFrame, true).then(() => {
          this.currentFrame += 1;
          this.renderInFlight = false;
        });
      }
      this.playHandle = setTimeout(loop, Math.max(1, frameMs / 4));
    };
    this.emitter.emit("play", { frame: this.currentFrame });
    loop();
  }
  pause() {
    if (!this.playing) return;
    this.playing = false;
    if (this.playHandle != null) {
      clearTimeout(this.playHandle);
      this.playHandle = null;
    }
    this.narrationTrack?.stopAll();
    this.emitter.emit("pause", { frame: this.currentFrame });
  }
  dispose() {
    this.pause();
    this.scrub.dispose();
    this.disposeSessions();
    if (this.audioCtx) {
      void this.audioCtx.close().catch(() => void 0);
      this.audioCtx = null;
    }
    this.timeline = null;
    this.canvas = null;
    this.ctx = null;
    this.disposed = true;
    this.emitter.emit("dispose", {});
    this.emitter.removeAll();
  }
  // --- 内部実装 ---
  /** frame（タイムラインフレーム）秒換算の位置から narration を再スケジュールする。narration 無し/未ロードなら no-op */
  rescheduleNarrationFrom(frame) {
    if (!this.narrationTrack || !this.audioCtx || !this.timeline) return;
    const atSec = frame / this.timeline.fps;
    this.narrationTrack.scheduleFrom(atSec, this.audioCtx.currentTime, this.audioCtx.destination);
  }
  getSession(clipId) {
    const s = this.sessions.get(clipId);
    if (!s) throw new Error(`unknown clip session: ${clipId}`);
    return s;
  }
  async executeScrubTick(frame, generation) {
    if (this.disposed || !this.timeline) return;
    const resolved = this.timeline.resolve(frame);
    if (!resolved) return;
    const session = this.getSession(resolved.clip.id);
    if (session.state === "idle") {
      void session.load().then(
        () => this.startThumbnailBuild(resolved.clip.id, session),
        () => void 0
      );
      return;
    }
    if (session.state === "ready" || session.state === "degraded") {
      this.startThumbnailBuild(resolved.clip.id, session);
    }
    const toleranceUs = Math.min(0.75, 0.15 * resolved.activeLayerCount) * 1e6;
    const cache = this.cache.get(resolved.clip.id);
    const cached = cache?.getClone(resolved.localFrame);
    let video;
    let tickMs;
    let approx = true;
    if (cached) {
      video = cached.frame;
      tickMs = 0;
    } else {
      const ret2 = await session.tickApprox(resolved.sourceTimeUs, toleranceUs, this.opts.keyframeSnapBeyondTolerance);
      video = ret2.video;
      tickMs = ret2.tickMs;
      approx = ret2.approx;
    }
    if (this.scrub.isStale(generation)) {
      video?.close();
      return;
    }
    this.currentFrame = frame;
    this.renderFrame(video, resolved.clip.id, frame, approx, tickMs);
    this.maybeWarmup(resolved);
  }
  async resolveAndRender(frame, fromPlay) {
    if (!this.timeline) return;
    const resolved = this.timeline.resolve(frame);
    if (!resolved) return;
    const session = this.getSession(resolved.clip.id);
    if (session.state === "idle") {
      try {
        await session.load();
      } catch {
      }
    }
    if (session.state === "ready" || session.state === "degraded") {
      this.startThumbnailBuild(resolved.clip.id, session);
    }
    const cache = this.cache.get(resolved.clip.id);
    const cached = cache?.getClone(resolved.localFrame);
    let video;
    let tickMs = 0;
    if (cached) {
      video = cached.frame;
    } else {
      const ret2 = await session.tickExact(resolved.sourceTimeUs);
      video = ret2.video;
      tickMs = ret2.tickMs;
      if (video && cache) {
        cache.put(resolved.localFrame, video.clone(), tickMs);
      }
    }
    this.currentFrame = frame;
    this.renderFrame(video, resolved.clip.id, frame, false, tickMs);
    this.maybeWarmup(resolved);
    if (!fromPlay) this.prefetchForward(resolved);
  }
  maybeWarmup(resolved) {
    if (!resolved.nextClip) return;
    const nextSession = this.sessions.get(resolved.nextClip.id) ?? null;
    this.warmupMgr.maybeWarmup(
      resolved.secondsToBoundary,
      nextSession,
      resolved.nextClip.sourceInUs ?? 0,
      (clipId, tookMs) => {
        this.emitter.emit("warmup", { clipId, primedAtFrame: this.currentFrame, tookMs });
      },
      this.timeline ? 1e6 / this.timeline.fps : 1e6 / 30
    );
  }
  prefetchForward(resolved) {
    const cache = this.cache.get(resolved.clip.id);
    const session = this.sessions.get(resolved.clip.id);
    if (!cache || !session || session.state === "unavailable" || !this.timeline) return;
    if (this.prefetchInFlight.has(resolved.clip.id)) return;
    this.prefetchInFlight.add(resolved.clip.id);
    const fps = this.timeline.fps;
    const startLocal = resolved.localFrame + 1;
    const count = Math.min(4, this.opts.lookaheadCacheSize);
    void (async () => {
      try {
        for (let i2 = 0; i2 < count; i2++) {
          const lf = startLocal + i2;
          if (cache.has(lf)) continue;
          const srcTimeUs = (resolved.clip.sourceInUs ?? 0) + lf / fps * 1e6;
          const ret2 = await session.tickBackground(srcTimeUs);
          if (ret2.video) cache.put(lf, ret2.video, ret2.tickMs);
          else break;
        }
      } finally {
        this.prefetchInFlight.delete(resolved.clip.id);
      }
    })();
  }
  renderFrame(video, clipId, frame, approx, tickMs) {
    let drawn = false;
    if (video) {
      if (this.ctx && this.canvas) {
        this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
        drawn = true;
        this.lastThumbnailKey = null;
      }
      video.close();
    }
    this.emitter.emit("frame", { frame, clipId, approx, tickMs, drawn });
  }
  startThumbnailBuild(clipId, session) {
    if (!this.opts.enableThumbnailScrub || this.thumbnailBuildStarted.has(clipId) || !session.meta) return;
    const track = this.thumbnailTracks.get(clipId);
    const sourceRange = this.thumbnailSourceRanges.get(clipId);
    if (!track || !sourceRange) return;
    this.thumbnailBuildStarted.add(clipId);
    void track.build(session, sourceRange.startUs, sourceRange.endUs, session.getKeyframeTimesUs()).catch((e) => {
      if (this.disposed || !this.sessions.has(clipId)) return;
      this.emitter.emit("error", {
        clipId,
        message: `thumbnail track build failed: ${String(e)}`,
        detail: e
      });
    });
  }
  tryDrawThumbnail(frame) {
    if (!this.opts.enableThumbnailScrub || !this.timeline || !this.ctx || !this.canvas) return;
    const resolved = this.timeline.resolve(frame);
    if (!resolved) return;
    const entry = this.thumbnailTracks.get(resolved.clip.id)?.nearest(resolved.sourceTimeUs);
    if (!entry) return;
    const key = `${resolved.clip.id}:${entry.timeUs}`;
    if (key === this.lastThumbnailKey) return;
    this.ctx.drawImage(entry.bitmap, 0, 0, this.canvas.width, this.canvas.height);
    this.lastThumbnailKey = key;
    this.emitter.emit("thumbnail", { frame, clipId: resolved.clip.id, drawnAtMs: performance.now() });
  }
  disposeSessions() {
    this.narrationTrack?.dispose();
    this.narrationTrack = null;
    this.audioSpec = null;
    for (const s of this.sessions.values()) s.destroy();
    this.sessions.clear();
    for (const c of this.cache.values()) c.clear();
    this.cache.clear();
    this.prefetchInFlight.clear();
    for (const track of this.thumbnailTracks.values()) track.clear();
    this.thumbnailTracks.clear();
    this.thumbnailBuildStarted.clear();
    this.thumbnailSourceRanges.clear();
    this.lastThumbnailKey = null;
    this.warmupMgr.reset();
  }
};
export {
  AUDIO_GAIN_DB_MAX,
  AUDIO_GAIN_DB_MIN,
  ClipSession,
  LookaheadCache,
  NarrationTrack,
  PreviewEngine,
  STATIC_DUCK_GAIN_DB,
  ScrubController,
  ThumbnailTrack,
  Timeline,
  WarmupManager,
  buildKeyframeIndexFromHeader,
  clampGainDb,
  computeBgmDuckGainDb,
  computeDuckIntervals,
  dbToLinear,
  isWithinDuckInterval,
  validateNarrationSpecs
};
