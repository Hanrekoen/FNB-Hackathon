// Authenticated encryption for everything stored on the device.
// Key: PBKDF2-HMAC-SHA256 (600k iterations, OWASP 2023) from the user's PIN + a random salt.
// Cipher: AES-256-GCM with a fresh random 96-bit IV on every save. Keys are non-extractable.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const KDF_ITERATIONS = 600_000;
// Bounds for iteration counts read from storage or a backup file: too low is insecure,
// too high would let a crafted file freeze the phone.
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 5_000_000;

export const randomBytes = (n) => crypto.getRandomValues(new Uint8Array(n));

export async function deriveKey(secret, salt, iterations = KDF_ITERATIONS) {
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new RangeError('Invalid key-derivation iteration count');
  }
  const material = await crypto.subtle.importKey('raw', enc.encode(secret.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJSON(key, value, aad) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: enc.encode(aad) },
    key,
    enc.encode(JSON.stringify(value)),
  );
  return { iv: toB64(iv), ct: toB64(new Uint8Array(ct)) };
}

/** Throws if the key is wrong or the data was tampered with (GCM authentication fails). */
export async function decryptJSON(key, { iv, ct }, aad) {
  const pt = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromB64(iv), additionalData: enc.encode(aad) },
    key,
    fromB64(ct),
  );
  return JSON.parse(dec.decode(pt));
}

export function toB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromB64(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

const B64 = /^[A-Za-z0-9+/]+={0,2}$/;

/** Validates the shape of an encrypted record read from storage or an imported file. */
export function isSealedRecord(r, maxCt = 8_000_000) {
  return (
    r !== null && typeof r === 'object' &&
    typeof r.salt === 'string' && B64.test(r.salt) && fromB64(r.salt).length === 16 &&
    Number.isInteger(r.iter) && r.iter >= MIN_ITERATIONS && r.iter <= MAX_ITERATIONS &&
    typeof r.iv === 'string' && B64.test(r.iv) && fromB64(r.iv).length === 12 &&
    typeof r.ct === 'string' && r.ct.length <= maxCt && B64.test(r.ct)
  );
}
