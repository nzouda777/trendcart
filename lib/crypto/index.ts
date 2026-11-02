import "server-only";

import { createCipher, type Cipher, type CipherOptions } from "./cipher";

export {
  CryptoError,
  createCipher,
  isEnvelope,
  parseKeyring,
  type Cipher,
  type CipherOptions,
  type Keyring,
} from "./cipher";

/*
 * App-wide cipher built from ENCRYPTION_KEY (lazily, so builds and tests run
 * without it). Use for OAuth tokens, proxy URLs, Shopify client secrets and
 * Spark Ads codes. Pass an `aad` naming the row and column when you can:
 *
 *   const enc = encrypt(token, { aad: aadFor("shopify_connection", id, "access_token") });
 */

let cipher: Cipher | undefined;

function getCipher(): Cipher {
  if (cipher) return cipher;
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  cipher = createCipher(key);
  return cipher;
}

export function encrypt(plaintext: string, options?: CipherOptions): string {
  return getCipher().encrypt(plaintext, options);
}

export function decrypt(envelope: string, options?: CipherOptions): string {
  return getCipher().decrypt(envelope, options);
}

export function encryptNullable(
  plaintext: string | null | undefined,
  options?: CipherOptions,
): string | null {
  return plaintext == null ? null : encrypt(plaintext, options);
}

export function decryptNullable(
  envelope: string | null | undefined,
  options?: CipherOptions,
): string | null {
  return envelope == null ? null : decrypt(envelope, options);
}

export function needsRotation(envelope: string): boolean {
  return getCipher().needsRotation(envelope);
}

export function rotate(envelope: string, options?: CipherOptions): string {
  return getCipher().rotate(envelope, options);
}

/** Conventional AAD: `<table>:<rowId>:<column>`. */
export function aadFor(table: string, rowId: string, column: string): string {
  return `${table}:${rowId}:${column}`;
}
