// Rules for choosing a PIN / password. Returns an i18n error key, or null if acceptable.

const COMMON = new Set([
  '123456', '654321', '123123', '112233', '121212', '159753', '147258', '258369',
  '696969', '101010', '111222', '123321', '000000', '102030', '142536', '199000',
  'password', 'qwerty', 'qwertyuiop', 'iloveyou', 'abc123', 'abcdef', 'letmein',
  'password1', 'wagwoord', 'monkey', 'dragon', 'football', 'sunshine', 'princess',
]);

function isDigitSequence(s) {
  if (!/^\d+$/.test(s)) return false;
  const steps = new Set();
  for (let i = 1; i < s.length; i++) steps.add((Number(s[i]) - Number(s[i - 1]) + 10) % 10);
  return steps.size === 1 && (steps.has(1) || steps.has(9));
}

export const isWeak = (s) => COMMON.has(s.toLowerCase()) || /^(.{1,3})\1+$/.test(s) || isDigitSequence(s);

export function checkNewSecret(secret, confirm) {
  if (secret.length < 6) return 'err.pinShort';
  if (secret.length > 64) return 'err.pinLong';
  if (isWeak(secret)) return 'err.pinWeak';
  if (secret !== confirm) return 'err.pinMatch';
  return null;
}

/** Backups can leave the phone, so they need a longer password that resists offline guessing. */
export function checkBackupPassword(pass, confirm) {
  if (pass.length < 10) return 'err.backupShort';
  if (pass.length > 128) return 'err.pinLong';
  if (/^\d+$/.test(pass) || isWeak(pass)) return 'err.pinWeak';
  if (pass !== confirm) return 'err.pinMatch';
  return null;
}
