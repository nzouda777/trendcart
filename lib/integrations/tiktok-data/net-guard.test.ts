import type { LookupAddress } from "node:dns";

import { fetch as undiciFetch } from "undici";
import { describe, expect, it } from "vitest";

import { networkError } from "./http";
import {
  assertPublicHostname,
  assertPublicHostResolves,
  BlockedAddressError,
  createGuardedAgent,
  createGuardedLookup,
  findBlockedAddress,
  isPublicIp,
} from "./net-guard";

/** Offline resolver: fixed answers per hostname. */
function resolver(table: Record<string, string[]>) {
  return (
    hostname: string,
    _options: { all: true },
    callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
  ) => {
    const ips = table[hostname];
    if (!ips) return callback(Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }), []);
    callback(
      null,
      ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })),
    );
  };
}

describe("isPublicIp", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.5",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "100.127.255.254",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "::ffff:169.254.169.254",
    "::127.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "2002:c0a8:0101::1",
    "[::1]",
    "not-an-ip",
  ])("blocks %s", (ip) => {
    expect(isPublicIp(ip)).toBe(false);
  });

  it.each([
    "8.8.8.8",
    "93.184.215.14",
    "172.32.0.1",
    "100.128.0.1",
    "2606:4700::1111",
    "::ffff:8.8.8.8",
    "64:ff9b::808:808",
  ])("allows %s", (ip) => {
    expect(isPublicIp(ip)).toBe(true);
  });
});

describe("assertPublicHostname", () => {
  it.each([
    "localhost",
    "intranet",
    "printer.local",
    "db.internal",
    "127.0.0.1",
    "[::1]",
    "2130706433",
    "0x7f000001",
    "0x7f.1",
  ])("rejects %s", (host) => {
    expect(() => assertPublicHostname(host)).toThrow(BlockedAddressError);
  });

  it("accepts public names and IPs", () => {
    expect(() => assertPublicHostname("shop.example.com")).not.toThrow();
    expect(() => assertPublicHostname("8.8.8.8")).not.toThrow();
  });
});

describe("guarded DNS lookup", () => {
  const resolve = resolver({
    "127.0.0.1.nip.io": ["127.0.0.1"],
    "rebind.example.com": ["93.184.215.14", "10.0.0.7"],
    "metadata.example.com": ["::ffff:169.254.169.254"],
    "shop.example.com": ["93.184.215.14", "2606:4700::1111"],
  });

  it.each(["127.0.0.1.nip.io", "rebind.example.com", "metadata.example.com"])(
    "rejects %s when any address is private",
    async (host) => {
      await expect(assertPublicHostResolves(host, resolve)).rejects.toBeInstanceOf(
        BlockedAddressError,
      );
    },
  );

  it("passes public answers through in both lookup styles", async () => {
    await expect(assertPublicHostResolves("shop.example.com", resolve)).resolves.toBeUndefined();
    const lookup = createGuardedLookup(resolve) as unknown as (
      h: string,
      o: { all?: boolean },
      cb: (...args: unknown[]) => void,
    ) => void;
    const single = await new Promise<unknown[]>((ok) =>
      lookup("shop.example.com", {}, (...a) => ok(a)),
    );
    expect(single).toEqual([null, "93.184.215.14", 4]);
    const all = await new Promise<unknown[]>((ok) =>
      lookup("shop.example.com", { all: true }, (...a) => ok(a)),
    );
    expect((all[1] as LookupAddress[]).map((a) => a.address)).toEqual([
      "93.184.215.14",
      "2606:4700::1111",
    ]);
  });
});

describe("guarded dispatcher at connect time (no network)", () => {
  const agent = createGuardedAgent(
    resolver({ "127.0.0.1.nip.io": ["127.0.0.1"], "evil.example.com": ["192.168.0.10"] }),
  );

  it.each([
    "http://127.0.0.1.nip.io/admin",
    "http://evil.example.com/",
    "http://127.0.0.1:8080/",
    "http://[::1]:8080/",
    "http://169.254.169.254/latest/meta-data/",
  ])("refuses %s before connecting", async (url) => {
    const error = await undiciFetch(url, { dispatcher: agent }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(findBlockedAddress(error)).toBeInstanceOf(BlockedAddressError);
    expect(networkError("product-page", error)).toMatchObject({
      code: "invalid_input",
      retryable: false,
    });
  });
});
