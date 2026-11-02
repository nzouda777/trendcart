/**
 * AES-256-GCM with a versioned keyring (pure, testable; no env access).
 *
 * Envelope format (all parts base64url, dot-separated):
 *
 *   tc1.<keyVersion>.<iv 12 bytes>.<authTag 16 bytes>.<ciphertext>
 *
 * `tc1` is the envelope format, `keyVersion` the keyring entry used. Old
 * versions stay in the keyring so existing rows still decrypt; `rotate()`
 * re-encrypts them under the active key.
 *
 * Optional AAD (additional authenticated data) binds a ciphertext to its
 * place, e.g. `shopify_connection:${id}:access_token`, so a value copied into
 * another row or column fails to decrypt.
 */
import "server-only";

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const FORMAT = "tc1";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

export type Keyring = {
  /** Version used for new encryptions. */
  activeVersion: number;
  keys: ReadonlyMap<number, Buffer>;
};

export type CipherOptions = {
  /** Additional authenticated data; must match on decrypt. */
  aad?: string;
};

export class CryptoError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "CryptoError";
  }
}

function decodeKey(raw: string, label: string): Buffer {
  const value = raw.trim();
  const key = /^[0-9a-fA-F]{64}$/.test(value)
    ? Buffer.from(value, "hex")
    : Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(
      `${label} must be ${KEY_BYTES} bytes (base64 or hex); got ${key.length}. ` +
        `Generate one with: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  return key;
}

/**
 * Parses ENCRYPTION_KEY.
 *
 * - `"<key>"`: a single key, version 1.
 * - `"3:<key>,2:<key>,1:<key>"`: a keyring; the FIRST entry is active.
 *
 * To rotate: prepend a new `N+1:<key>` entry, deploy, re-encrypt rows with
 * `rotate()`, then drop old entries once nothing uses them.
 */
export function parseKeyring(input: string): Keyring {
  const raw = input.trim();
  if (!raw) throw new CryptoError("ENCRYPTION_KEY is empty.");

  const entries = raw
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  const keys = new Map<number, Buffer>();
  let activeVersion: number | undefined;

  for (const entry of entries) {
    const match = /^(\d+):(.+)$/.exec(entry);
    if (!match && entries.length > 1) {
      throw new CryptoError('Keyring entries must look like "<version>:<key>".');
    }
    const version = match ? Number(match[1]) : 1;
    if (!Number.isSafeInteger(version) || version < 1) {
      throw new CryptoError(`Invalid key version "${match?.[1]}".`);
    }
    if (keys.has(version)) throw new CryptoError(`Duplicate key version ${version}.`);
    keys.set(version, decodeKey(match ? match[2] : entry, `Key v${version}`));
    activeVersion ??= version;
  }

  if (activeVersion === undefined) throw new CryptoError("ENCRYPTION_KEY has no keys.");
  return { activeVersion, keys };
}

const b64 = (buf: Buffer) => buf.toString("base64url");
const unb64 = (s: string) => Buffer.from(s, "base64url");

export type ParsedEnvelope = { version: number; iv: Buffer; tag: Buffer; ciphertext: Buffer };

export function parseEnvelope(envelope: string): ParsedEnvelope {
  const parts = envelope.split(".");
  if (parts.length !== 5 || parts[0] !== FORMAT) {
    throw new CryptoError("Not a Trendcart encrypted value.");
  }
  const version = Number(parts[1]);
  const iv = unb64(parts[2]);
  const tag = unb64(parts[3]);
  const ciphertext = unb64(parts[4]);
  if (!Number.isSafeInteger(version) || iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new CryptoError("Malformed encrypted value.");
  }
  return { version, iv, tag, ciphertext };
}

export function isEnvelope(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    parseEnvelope(value);
    return true;
  } catch {
    return false;
  }
}

export type Cipher = {
  encrypt(plaintext: string, options?: CipherOptions): string;
  decrypt(envelope: string, options?: CipherOptions): string;
  /** Key version an envelope was encrypted with. */
  keyVersionOf(envelope: string): number;
  /** True when the envelope was not encrypted with the active key. */
  needsRotation(envelope: string): boolean;
  /** Re-encrypts under the active key (no-op result if already current). */
  rotate(envelope: string, options?: CipherOptions): string;
  readonly activeVersion: number;
};

export function createCipher(keyring: Keyring | string): Cipher {
  const ring = typeof keyring === "string" ? parseKeyring(keyring) : keyring;
  const activeKey = ring.keys.get(ring.activeVersion);
  if (!activeKey) throw new CryptoError("Active key version is missing from the keyring.");

  function encrypt(plaintext: string, options?: CipherOptions): string {
    if (typeof plaintext !== "string") throw new CryptoError("Plaintext must be a string.");
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGORITHM, activeKey!, iv, { authTagLength: TAG_BYTES });
    if (options?.aad !== undefined) cipher.setAAD(Buffer.from(options.aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [FORMAT, String(ring.activeVersion), b64(iv), b64(tag), b64(ciphertext)].join(".");
  }

  function decrypt(envelope: string, options?: CipherOptions): string {
    const { version, iv, tag, ciphertext } = parseEnvelope(envelope);
    const key = ring.keys.get(version);
    if (!key) throw new CryptoError(`No key for version ${version} in the keyring.`);
    try {
      const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
      if (options?.aad !== undefined) decipher.setAAD(Buffer.from(options.aad, "utf8"));
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
    } catch (cause) {
      // Wrong key, wrong AAD or tampered data. Never echo the input.
      throw new CryptoError("Decryption failed.", { cause });
    }
  }

  return {
    encrypt,
    decrypt,
    keyVersionOf: (envelope) => parseEnvelope(envelope).version,
    needsRotation: (envelope) => parseEnvelope(envelope).version !== ring.activeVersion,
    rotate(envelope, options) {
      if (parseEnvelope(envelope).version === ring.activeVersion) return envelope;
      return encrypt(decrypt(envelope, options), options);
    },
    activeVersion: ring.activeVersion,
  };
}
