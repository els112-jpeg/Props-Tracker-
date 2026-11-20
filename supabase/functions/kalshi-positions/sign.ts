// Kalshi request signing. Supports Ed25519 (default) and RSA-PSS keys, PKCS#8 or PKCS#1 PEM.
const toB64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

function pemToDer(pem: string): { der: Uint8Array; type: string } {
  const text = pem.replace(/\\n/g, "\n").trim();
  const m = /-----BEGIN ([A-Z ]+)-----([\s\S]+?)-----END \1-----/.exec(text);
  if (!m) throw new Error("KALSHI_PRIVATE_KEY is not a PEM block");
  const bin = atob(m[2].replace(/\s+/g, ""));
  return { der: Uint8Array.from(bin, (c) => c.charCodeAt(0)), type: m[1] };
}

function derLen(n: number): number[] {
  if (n < 128) return [n];
  if (n < 256) return [0x81, n];
  return [0x82, n >> 8, n & 255];
}

// Wrap an RSA PKCS#1 key into PKCS#8 so WebCrypto can import it.
function wrapPkcs1(der: Uint8Array): Uint8Array {
  const algId = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];
  const inner = [0x02, 0x01, 0x00, ...algId, 0x04, ...derLen(der.length)];
  const total = inner.length + der.length;
  return new Uint8Array([0x30, ...derLen(total), ...inner, ...der]);
}

export async function makeSigner(pem: string): Promise<(msg: string) => Promise<string>> {
  const { der, type } = pemToDer(pem);
  const rsa = { name: "RSA-PSS", hash: "SHA-256" };
  let key: CryptoKey;
  let alg: any;
  if (type === "RSA PRIVATE KEY") {
    key = await crypto.subtle.importKey("pkcs8", wrapPkcs1(der), rsa, false, ["sign"]);
    alg = { name: "RSA-PSS", saltLength: 32 };
  } else {
    try {
      key = await crypto.subtle.importKey("pkcs8", der, { name: "Ed25519" }, false, ["sign"]);
      alg = { name: "Ed25519" };
    } catch (_e) {
      key = await crypto.subtle.importKey("pkcs8", der, rsa, false, ["sign"]);
      alg = { name: "RSA-PSS", saltLength: 32 };
    }
  }
  return async (msg: string) =>
    toB64(new Uint8Array(await crypto.subtle.sign(alg, key, new TextEncoder().encode(msg))));
}
