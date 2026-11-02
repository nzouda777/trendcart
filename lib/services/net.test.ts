import { describe, expect, it } from "vitest";

import { isPublicHost } from "./net";

describe("isPublicHost", () => {
  it("accepts public names and public IP literals", () => {
    for (const h of ["proxy.example.net", "203.0.113.7", "8.8.8.8", "[2001:4860:4860::8888]"]) {
      expect(isPublicHost(h), h).toBe(true);
    }
  });

  it("rejects loopback, private, link-local, CGNAT, reserved and internal names", () => {
    for (const h of [
      "localhost",
      "api.localhost",
      "intranet",
      "printer.local",
      "metadata.google.internal",
      "127.0.0.1",
      "2130706433",
      "0x7f000001",
      "0.0.0.0",
      "10.0.0.1",
      "100.64.1.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.0.1",
      "198.18.0.1",
      "224.0.0.1",
      "[::1]",
      "[::]",
      "[::ffff:127.0.0.1]",
      "[fc00::1]",
      "[fe80::1]",
      "",
    ]) {
      expect(isPublicHost(h), h).toBe(false);
    }
  });
});
