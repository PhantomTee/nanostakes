import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * Interim hardening for agent session private keys at rest: AES-256-GCM
 * instead of plaintext in SQLite. The key is derived from WARDEN_PRIVATE_KEY
 * (already a required secret) so no new env var/migration step is needed.
 *
 * This protects against a leaked DB file or backup, not against a compromised
 * running process — the Warden still holds the means to decrypt in memory,
 * same as it must to sign for agents. Circle Developer-Controlled Wallets
 * (Circle holds the key, never the Warden) is the real fix; see ARCHITECTURE.md.
 */
const ENCRYPTION_KEY = createHash("sha256").update(process.env.WARDEN_PRIVATE_KEY ?? "").digest();
const ALGO = "aes-256-gcm";
const PREFIX = "enc:v1:";

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, ENCRYPTION_KEY, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Decrypts a value written by `encryptSecret`. Returns the input unchanged if it
 *  doesn't carry the encrypted-value prefix, so pre-existing plaintext rows still read. */
export function decryptSecret(value: string): string {
  if (!value.startsWith(PREFIX)) return value;
  const raw = Buffer.from(value.slice(PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv(ALGO, ENCRYPTION_KEY, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
