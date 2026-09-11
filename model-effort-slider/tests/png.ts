/** Minimal PNG fixtures for tests: signature + real IHDR (the host checks both). */
export function png(width = 160, height = 160): Uint8Array {
  const bytes = new Uint8Array(1024);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82], 0);
  new DataView(bytes.buffer).setUint32(16, width);
  new DataView(bytes.buffer).setUint32(20, height);
  bytes.set([8, 6, 0, 0, 0], 24);
  return bytes;
}

/** A 160 × 160 PNG whose bytes differ per `seed`, for order assertions. */
export function pngVaried(seed: number): Uint8Array {
  const bytes = png();
  bytes[bytes.length - 1] = seed % 256;
  bytes[bytes.length - 2] = (seed * 7) % 256;
  return bytes;
}

export function dataUrl(bytes: Uint8Array, type = 'image/png'): string {
  return `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
}
