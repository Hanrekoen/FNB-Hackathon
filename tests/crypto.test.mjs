import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MIN_ITERATIONS, decryptJSON, deriveKey, encryptJSON, fromB64, isSealedRecord, randomBytes, toB64,
} from '../js/core/crypto.js';

const AAD = 'test.v1';
const salt = randomBytes(16);
// The minimum allowed count keeps tests fast; the app uses 600k.
const key = await deriveKey('583920', salt, MIN_ITERATIONS);

test('round-trips data', async () => {
  const value = { name: 'Thandi', notes: ['ñ', '😀'], n: 42 };
  assert.deepEqual(await decryptJSON(key, await encryptJSON(key, value, AAD), AAD), value);
});

test('uses a fresh IV every time', async () => {
  const a = await encryptJSON(key, 1, AAD);
  const b = await encryptJSON(key, 1, AAD);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
});

test('wrong PIN, tampered data, or wrong context all fail', async () => {
  const sealed = await encryptJSON(key, { a: 1 }, AAD);
  const wrong = await deriveKey('583921', salt, MIN_ITERATIONS);
  await assert.rejects(decryptJSON(wrong, sealed, AAD));

  const bytes = fromB64(sealed.ct);
  bytes[0] ^= 1;
  await assert.rejects(decryptJSON(key, { ...sealed, ct: toB64(bytes) }, AAD));

  await assert.rejects(decryptJSON(key, sealed, 'other.v1'));
});

test('keys cannot be exported', async () => {
  await assert.rejects(crypto.subtle.exportKey('raw', key));
});

test('rejects unsafe iteration counts', async () => {
  await assert.rejects(deriveKey('x', salt, 1000), RangeError);
  await assert.rejects(deriveKey('x', salt, 1e9), RangeError);
});

test('validates sealed record shape', async () => {
  const sealed = { salt: toB64(salt), iter: 600_000, ...(await encryptJSON(key, 1, AAD)) };
  assert.ok(isSealedRecord(sealed));
  assert.ok(!isSealedRecord({ ...sealed, iter: 10 }));
  assert.ok(!isSealedRecord({ ...sealed, iv: toB64(randomBytes(8)) }));
  assert.ok(!isSealedRecord({ ...sealed, ct: '<script>' }));
  assert.ok(!isSealedRecord(null));
});

test('base64 handles large buffers', () => {
  const big = Uint8Array.from({ length: 200_000 }, (_, i) => (i * 31) & 0xff);
  assert.deepEqual(fromB64(toB64(big)), big);
});
