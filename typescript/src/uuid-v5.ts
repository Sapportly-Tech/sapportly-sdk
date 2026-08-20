/** UUID v5 (SHA-1). Совпадает с `Uuid::new_v5` в шлюзе. */

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

function uuidToBytes(id: string): Uint8Array {
  const hex = id.replace(/-/g, "");
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

async function sha1(data: Uint8Array): Promise<Uint8Array> {
  const copy = new ArrayBuffer(data.byteLength);
  new Uint8Array(copy).set(data);
  const fromGlobal = globalThis.crypto?.subtle;
  if (fromGlobal) {
    const buf = await fromGlobal.digest("SHA-1", copy);
    return new Uint8Array(buf);
  }
  const { webcrypto } = await import("node:crypto");
  const buf = await webcrypto.subtle.digest("SHA-1", copy);
  return new Uint8Array(buf);
}

export async function uuidV5(namespace: string, name: Uint8Array): Promise<string> {
  const ns = uuidToBytes(namespace);
  const joined = new Uint8Array(ns.length + name.length);
  joined.set(ns, 0);
  joined.set(name, ns.length);
  const hash = await sha1(joined);
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  return bytesToUuid(hash.subarray(0, 16));
}
