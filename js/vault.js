// The encrypted vault: the only place user data lives. While locked, nothing readable is in
// memory; while unlocked, the key is a non-extractable CryptoKey held only in this module.

import {
  KDF_ITERATIONS, decryptJSON, deriveKey, encryptJSON, fromB64, isSealedRecord, randomBytes, toB64,
} from './core/crypto.js';
import { todayISO } from './core/dates.js';
import { emptyData as schemaEmpty, normalize as normalizeData } from './core/schema.js';
import * as idb from './idb.js';

const VAULT = 'vault';
const META = 'meta';
const VAULT_AAD = 'imali.vault.v1';
const BACKUP_AAD = 'imali.backup.v1';
const FREE_ATTEMPTS = 5;
export const WIPE_AFTER = 10;

let key = null;
let header = null;
let data = null;
let saveQueue = Promise.resolve();

export const isUnlocked = () => key !== null;
export const getData = () => data;
export const hasVault = async () => isSealedRecord(await idb.get(VAULT));

export async function getMeta() {
  return { fails: 0, lockUntil: 0, wipeOnFails: false, ...(await idb.get(META)) };
}

export async function setWipeOnFails(on) {
  await idb.set(META, { ...(await getMeta()), wipeOnFails: !!on });
}

export const emptyData = (name = '') => schemaEmpty(name, todayISO());

/** Defensive normalisation of decrypted data (e.g. from an older version or a backup). */
const normalize = (d) => normalizeData(d, todayISO());

async function seal(newKey, newHeader, value) {
  const { iv, ct } = await encryptJSON(newKey, value, VAULT_AAD);
  await idb.set(VAULT, { ...newHeader, iv, ct });
}

async function freshKey(secret) {
  const salt = randomBytes(16);
  return { k: await deriveKey(secret, salt), h: { v: 1, salt: toB64(salt), iter: KDF_ITERATIONS } };
}

export async function create(secret, initial) {
  const { k, h } = await freshKey(secret);
  await seal(k, h, initial);
  await idb.set(META, { fails: 0, lockUntil: 0, wipeOnFails: false });
  key = k;
  header = h;
  data = initial;
}

/** Returns { ok } on success, otherwise { ok: false, fails, lockUntil, wiped }. */
export async function unlock(secret) {
  const meta = await getMeta();
  const now = Date.now();
  if (meta.lockUntil > now) return { ok: false, fails: meta.fails, lockUntil: meta.lockUntil };
  const rec = await idb.get(VAULT);
  if (!isSealedRecord(rec)) return { ok: false, missing: true };

  let k;
  let value;
  try {
    k = await deriveKey(secret, fromB64(rec.salt), rec.iter);
    value = await decryptJSON(k, rec, VAULT_AAD);
  } catch {
    const fails = meta.fails + 1;
    if (meta.wipeOnFails && fails >= WIPE_AFTER) {
      await wipe();
      return { ok: false, wiped: true };
    }
    // Exponential back-off: 30s after the 5th wrong PIN, doubling up to 1 hour.
    const lockUntil = fails >= FREE_ATTEMPTS ? now + Math.min(3_600_000, 30_000 * 2 ** (fails - FREE_ATTEMPTS)) : 0;
    await idb.set(META, { ...meta, fails, lockUntil });
    return { ok: false, fails, lockUntil };
  }

  await idb.set(META, { ...meta, fails: 0, lockUntil: 0 });
  key = k;
  header = { v: 1, salt: rec.salt, iter: rec.iter };
  data = normalize(value);
  // Upgrade vaults created with a weaker iteration count.
  if (rec.iter < KDF_ITERATIONS) await changeSecret(secret, secret);
  return { ok: true };
}

export function lock() {
  key = null;
  header = null;
  data = null;
}

/** Saves are queued so overlapping writes can never interleave. */
export function save() {
  if (!key) return Promise.reject(new Error('locked'));
  const [k, h, snapshot] = [key, header, structuredClone(data)];
  saveQueue = saveQueue.catch(() => {}).then(() => seal(k, h, snapshot));
  return saveQueue;
}

export async function verifySecret(secret) {
  const rec = await idb.get(VAULT);
  try {
    await decryptJSON(await deriveKey(secret, fromB64(rec.salt), rec.iter), rec, VAULT_AAD);
    return true;
  } catch {
    return false;
  }
}

/** Re-encrypts the vault under a new PIN with a new salt. Returns false if `current` is wrong. */
export async function changeSecret(current, next) {
  if (!key || !(await verifySecret(current))) return false;
  await saveQueue.catch(() => {});
  const { k, h } = await freshKey(next);
  await seal(k, h, data);
  key = k;
  header = h;
  return true;
}

export async function wipe() {
  lock();
  await idb.clear();
}

/** Backups are encrypted with their own (longer) password, since the file may leave the phone. */
export async function exportBackup(password) {
  if (!key) throw new Error('locked');
  const salt = randomBytes(16);
  const k = await deriveKey(password, salt);
  const sealed = await encryptJSON(k, data, BACKUP_AAD);
  return JSON.stringify({ app: 'imali', kind: 'backup', v: 1, salt: toB64(salt), iter: KDF_ITERATIONS, ...sealed });
}

/** Returns 'ok', 'invalid' (not a backup file) or 'wrongPassword'. */
export async function restoreBackup(text, password, newSecret) {
  let rec;
  try {
    rec = JSON.parse(text);
  } catch {
    return 'invalid';
  }
  if (rec?.app !== 'imali' || rec.kind !== 'backup' || !isSealedRecord(rec)) return 'invalid';
  let value;
  try {
    value = await decryptJSON(await deriveKey(password, fromB64(rec.salt), rec.iter), rec, BACKUP_AAD);
  } catch {
    return 'wrongPassword';
  }
  await create(newSecret, normalize(value));
  return 'ok';
}
