/**
 * Byte helpers shared by the browser and the host half. Everything here is
 * self-contained (no Buffer, no DOM) so the same code validates a signature
 * before decoding, in the page and again after the upload reaches the host.
 */

/** PNG signature: the only container the host stores. */
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length && PNG_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/** Pick the largest power-of-two window available for reverse decoding. */
function windowSize(): number {
  if (typeof globalThis.btoa !== 'function') return 0;
  for (const size of [0x8000, 0x4000, 0x2000, 0x1000, 0x800, 0x400, 0x200, 0x100]) {
    try {
      globalThis.btoa(String.fromCharCode(...new Uint8Array(size)));
      return size;
    } catch { /* try the next smaller window */ }
  }
  return 0;
}

/** Decode standard base64 (ignoring ASCII whitespace) or throw. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = globalThis.atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Encode bytes as standard base64, chunked so no argument spread is unbounded. */
export function bytesToBase64(bytes: Uint8Array): string {
  const size = windowSize();
  if (!size) throw new Error('当前环境不支持 base64 编码。');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += size) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + size, bytes.length)));
  }
  return globalThis.btoa(binary);
}

/** Copy bytes onto a plain ArrayBuffer, the shape `BodyInit`/`BlobPart` accept. */
export function bytesBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer;
}

/** Read the leading signature bytes of a data URL without decoding the payload. */
export function dataUrlHeader(value: string): Uint8Array {
  const comma = value.indexOf(',');
  if (!value.startsWith('data:') || comma < 0) throw new Error('无效的图片数据。');
  return base64ToBytes(value.slice(comma + 1, comma + 1 + 16));
}
