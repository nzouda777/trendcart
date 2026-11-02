import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { CryptoError, createCipher, isEnvelope, parseKeyring } from "./cipher";

const key = () => randomBytes(32).toString("base64");

describe("parseKeyring", () => {
  it("treats a bare key as version 1", () => {
    const ring = parseKeyring(key());
    expect(ring.activeVersion).toBe(1);
    expect([...ring.keys.keys()]).toEqual([1]);
  });

  it("uses the first entry of a keyring as the active key", () => {
    const ring = parseKeyring(`3:${key()}, 2:${key()},1:${key()}`);
    expect(ring.activeVersion).toBe(3);
    expect([...ring.keys.keys()].sort()).toEqual([1, 2, 3]);
  });

  it("accepts hex and base64url keys", () => {
    expect(parseKeyring(randomBytes(32).toString("hex")).keys.get(1)).toHaveLength(32);
    expect(parseKeyring(randomBytes(32).toString("base64url")).keys.get(1)).toHaveLength(32);
  });

  it("rejects short keys, duplicates, bad versions and empty input", () => {
    expect(() => parseKeyring(randomBytes(16).toString("base64"))).toThrow(CryptoError);
    expect(() => parseKeyring(`1:${key()},1:${key()}`)).toThrow(/Duplicate/);
    expect(() => parseKeyring(`0:${key()}`)).toThrow(CryptoError);
    expect(() => parseKeyring(`${key()},${key()}`)).toThrow(CryptoError);
    expect(() => parseKeyring("  ")).toThrow(CryptoError);
  });
});

describe("createCipher (AES-256-GCM)", () => {
  it("round-trips unicode and empty strings", () => {
    const cipher = createCipher(key());
    for (const value of ["shpat_123", "", "pässwörd ✓ 日本", "x".repeat(10_000)]) {
      const enc = cipher.encrypt(value);
      expect(enc).not.toContain(value || "\u0000");
      expect(cipher.decrypt(enc)).toBe(value);
    }
  });

  it("produces a versioned envelope and a fresh IV every time", () => {
    const cipher = createCipher(`7:${key()}`);
    const a = cipher.encrypt("same");
    const b = cipher.encrypt("same");
    expect(a).not.toBe(b);
    expect(a.startsWith("tc1.7.")).toBe(true);
    expect(isEnvelope(a)).toBe(true);
    expect(isEnvelope("plain-token")).toBe(false);
    expect(cipher.keyVersionOf(a)).toBe(7);
  });

  it("detects tampering with ciphertext, tag or iv", () => {
    const cipher = createCipher(key());
    const parts = cipher.encrypt("secret").split(".");
    for (const index of [2, 3, 4]) {
      const tampered = [...parts];
      const bytes = Buffer.from(tampered[index], "base64url");
      bytes[0] ^= 0x01;
      tampered[index] = bytes.toString("base64url");
      expect(() => cipher.decrypt(tampered.join("."))).toThrow(CryptoError);
    }
  });

  it("fails with the wrong key and never echoes the input", () => {
    const enc = createCipher(key()).encrypt("secret");
    const other = createCipher(key());
    expect(() => other.decrypt(enc)).toThrow("Decryption failed.");
  });

  it("binds ciphertexts to their AAD", () => {
    const cipher = createCipher(key());
    const enc = cipher.encrypt("token", { aad: "shopify_connection:1:access_token" });
    expect(cipher.decrypt(enc, { aad: "shopify_connection:1:access_token" })).toBe("token");
    expect(() => cipher.decrypt(enc, { aad: "shopify_connection:2:access_token" })).toThrow();
    expect(() => cipher.decrypt(enc)).toThrow();
  });

  it("rejects malformed envelopes", () => {
    const cipher = createCipher(key());
    expect(() => cipher.decrypt("nope")).toThrow(CryptoError);
    expect(() => cipher.decrypt("tc1.1.a.b.c")).toThrow(CryptoError);
    expect(() => cipher.decrypt("tc2.1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AA")).toThrow();
  });
});

describe("key rotation", () => {
  it("decrypts old versions, encrypts with the active one and rotates", () => {
    const v1 = key();
    const v2 = key();
    const old = createCipher(`1:${v1}`);
    const legacy = old.encrypt("refresh-token", { aad: "a" });

    const rotated = createCipher(`2:${v2},1:${v1}`);
    expect(rotated.activeVersion).toBe(2);
    expect(rotated.decrypt(legacy, { aad: "a" })).toBe("refresh-token");
    expect(rotated.needsRotation(legacy)).toBe(true);

    const fresh = rotated.rotate(legacy, { aad: "a" });
    expect(rotated.keyVersionOf(fresh)).toBe(2);
    expect(rotated.needsRotation(fresh)).toBe(false);
    expect(rotated.rotate(fresh, { aad: "a" })).toBe(fresh);
    expect(rotated.decrypt(fresh, { aad: "a" })).toBe("refresh-token");

    // After dropping v1, only re-encrypted values remain readable.
    const v2Only = createCipher(`2:${v2}`);
    expect(v2Only.decrypt(fresh, { aad: "a" })).toBe("refresh-token");
    expect(() => v2Only.decrypt(legacy, { aad: "a" })).toThrow(/No key for version 1/);
  });
});

describe("env-backed helpers (lib/crypto)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("reads ENCRYPTION_KEY lazily and round-trips", async () => {
    vi.stubEnv("ENCRYPTION_KEY", key());
    const { encrypt, decrypt, encryptNullable, decryptNullable, aadFor } = await import("./index");
    const aad = aadFor("proxy", "p1", "url");
    const enc = encrypt("http://user:pass@proxy:8080", { aad });
    expect(decrypt(enc, { aad })).toBe("http://user:pass@proxy:8080");
    expect(encryptNullable(null)).toBeNull();
    expect(decryptNullable(undefined)).toBeNull();
  });

  it("throws a helpful error when ENCRYPTION_KEY is missing", async () => {
    vi.stubEnv("ENCRYPTION_KEY", "");
    const { encrypt } = await import("./index");
    expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY is not set/);
  });
});
