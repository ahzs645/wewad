export class BinaryReader {
  constructor(buffer, offset = 0) {
    this.buffer = buffer;
    this.view = new DataView(buffer);
    this.offset = offset;
  }

  u8() {
    const value = this.view.getUint8(this.offset);
    this.offset += 1;
    return value;
  }

  u16() {
    const value = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return value;
  }

  u32() {
    const value = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  f32() {
    const value = this.view.getFloat32(this.offset, false);
    this.offset += 4;
    return value;
  }

  skip(count) {
    this.offset += count;
  }

  seek(position) {
    this.offset = position;
  }

  slice(length) {
    const value = this.buffer.slice(this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  string(length) {
    let value = "";
    for (let i = 0; i < length; i += 1) {
      const code = this.view.getUint8(this.offset + i);
      if (code === 0) {
        break;
      }
      value += String.fromCharCode(code);
    }
    this.offset += length;
    return value;
  }

  nullString() {
    let value = "";
    while (this.offset < this.buffer.byteLength) {
      const code = this.view.getUint8(this.offset);
      this.offset += 1;
      if (code === 0) {
        break;
      }
      value += String.fromCharCode(code);
    }
    return value;
  }
}

export function align(offset, alignment) {
  return Math.ceil(offset / alignment) * alignment;
}
