import "server-only";

/**
 * SSRF guard at the network layer.
 *
 * Hostname checks (lib/sourcing/links) are not enough: a public name can
 * resolve to a private address (127.0.0.1.nip.io, DNS rebinding). Every
 * direct (non-proxied) outbound request of the sourcing/AI adapters goes
 * through `guardedDispatcher()`, an undici Agent whose connector
 * - refuses IP-literal targets that are not public, and
 * - resolves names with `guardedLookup`, which fails when ANY resolved
 *   address is not public (the socket then connects to the vetted address,
 *   so there is no second, rebindable lookup).
 * The connector runs for every connection, so redirect hops are covered too.
 *
 * Proxied requests are resolved by the proxy; the brand proxy URL itself is
 * validated with `assertPublicHostname` / `assertPublicHostResolves`
 * (exported for lib/services).
 */
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";

import { Agent, buildConnector, type Dispatcher } from "undici";

/** Thrown (as a fetch `cause`) when a request would reach a non-public address. */
export class BlockedAddressError extends Error {
  readonly host: string;
  constructor(host: string, address?: string) {
    super(
      `Refusing to connect to a non-public address (${host}${address && address !== host ? ` -> ${address}` : ""}).`,
    );
    this.name = "BlockedAddressError";
    this.host = host;
  }
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8], // "this network"
  ["10.0.0.0", 8], // private
  ["100.64.0.0", 10], // CGNAT
  ["127.0.0.0", 8], // loopback
  ["169.254.0.0", 16], // link-local, cloud metadata
  ["172.16.0.0", 12], // private
  ["192.0.0.0", 24], // IETF protocol assignments
  ["192.0.2.0", 24], // TEST-NET-1
  ["192.88.99.0", 24], // 6to4 relay anycast
  ["192.168.0.0", 16], // private
  ["198.18.0.0", 15], // benchmarking
  ["198.51.100.0", 24], // TEST-NET-2
  ["203.0.113.0", 24], // TEST-NET-3
  ["224.0.0.0", 4], // multicast
  ["240.0.0.0", 4], // reserved + broadcast
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128], // unspecified
  ["::1", 128], // loopback
  ["100::", 64], // discard
  ["2001:db8::", 32], // documentation
  ["fc00::", 7], // unique local
  ["fe80::", 10], // link-local
  ["fec0::", 10], // site-local (deprecated)
  ["ff00::", 8], // multicast
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

/** Expands an IPv6 address (with optional embedded IPv4) to 8 hextets, or null. */
function ipv6Hextets(address: string): number[] | null {
  let addr = address
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .split("%")[0]!;
  const v4 = addr.match(/(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (v4) {
    const parts = v4[1]!.split(".").map(Number);
    if (parts.some((p) => p > 255)) return null;
    addr =
      addr.slice(0, -v4[1]!.length) +
      `${((parts[0]! << 8) | parts[1]!).toString(16)}:${((parts[2]! << 8) | parts[3]!).toString(16)}`;
  }
  const [head, tail, extra] = addr.split("::");
  if (extra !== undefined) return null;
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : null;
  const fill = t === null ? 0 : 8 - h.length - t.length;
  if (fill < 0 || (t === null && h.length !== 8)) return null;
  const all = [...h, ...Array<string>(fill).fill("0"), ...(t ?? [])];
  if (all.length !== 8 || all.some((x) => !/^[0-9a-f]{1,4}$/.test(x))) return null;
  return all.map((x) => parseInt(x, 16));
}

const v4FromHextets = (a: number, b: number) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;

/** True only for globally routable unicast addresses. Non-IP input returns false. */
export function isPublicIp(address: string): boolean {
  const ip = address.replace(/^\[|\]$/g, "");
  const family = isIP(ip);
  if (family === 4) return !blocked.check(ip, "ipv4");
  if (family !== 6) return false;

  const hx = ipv6Hextets(ip);
  if (!hx) return false;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (hx.slice(0, 5).every((x) => x === 0) && (hx[5] === 0xffff || hx[5] === 0)) {
    if (hx[5] === 0 && hx[6] === 0) return !blocked.check(ip, "ipv6"); // ::, ::1
    return isPublicIp(v4FromHextets(hx[6]!, hx[7]!));
  }
  // NAT64 64:ff9b::/96 embeds the IPv4 target.
  if (hx[0] === 0x64 && hx[1] === 0xff9b && hx.slice(2, 6).every((x) => x === 0)) {
    return isPublicIp(v4FromHextets(hx[6]!, hx[7]!));
  }
  // 6to4 2002:AABB:CCDD::/48 embeds an IPv4 address.
  if (hx[0] === 0x2002) return isPublicIp(v4FromHextets(hx[1]!, hx[2]!));
  return !blocked.check(ip, "ipv6");
}

const INTERNAL_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".corp",
  ".intranet",
  ".home.arpa",
];

/**
 * Static check of a hostname: IP literals must be public; names must be
 * dotted and not internal. Does not resolve DNS (see assertPublicHostResolves).
 */
export function assertPublicHostname(hostname: string): void {
  const host = hostname
    .toLowerCase()
    .replace(/\.$/, "")
    .replace(/^\[|\]$/g, "");
  if (isIP(host)) {
    if (!isPublicIp(host)) throw new BlockedAddressError(hostname);
    return;
  }
  // Numeric forms browsers/URL parsers accept as IPv4 (e.g. 2130706433, 0x7f.1).
  if (/^(0x[0-9a-f]+|\d+)(\.(0x[0-9a-f]+|\d+)){0,3}$/i.test(host))
    throw new BlockedAddressError(hostname);
  if (
    !host.includes(".") ||
    host === "localhost" ||
    INTERNAL_SUFFIXES.some((s) => host.endsWith(s))
  ) {
    throw new BlockedAddressError(hostname);
  }
}

export function isPublicHostname(hostname: string): boolean {
  try {
    assertPublicHostname(hostname);
    return true;
  } catch {
    return false;
  }
}

type Resolver = (
  hostname: string,
  options: { all: true; family?: number },
  callback: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

const systemResolver: Resolver = (hostname, options, callback) =>
  dnsLookup(hostname, options, callback);

/** A net.connect `lookup` that fails when any resolved address is not public. */
export function createGuardedLookup(resolve: Resolver = systemResolver): LookupFunction {
  const lookup = (
    hostname: string,
    options: { all?: boolean; family?: number | string },
    callback: (...args: unknown[]) => void,
  ) => {
    const family = typeof options.family === "number" ? options.family : undefined;
    resolve(hostname, { all: true, ...(family ? { family } : {}) }, (err, addresses) => {
      if (err) return callback(err);
      const bad = addresses.find((a) => !isPublicIp(a.address));
      if (bad || addresses.length === 0)
        return callback(new BlockedAddressError(hostname, bad?.address));
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
  return lookup as unknown as LookupFunction;
}

/** Resolves a hostname now and throws BlockedAddressError unless every address is public. */
export async function assertPublicHostResolves(
  hostname: string,
  resolve: Resolver = systemResolver,
): Promise<void> {
  assertPublicHostname(hostname);
  const host = hostname.replace(/^\[|\]$/g, "");
  if (isIP(host)) return;
  const lookup = createGuardedLookup(resolve) as unknown as (
    h: string,
    o: { all: true },
    cb: (err: Error | null) => void,
  ) => void;
  await new Promise<void>((ok, fail) =>
    lookup(host, { all: true }, (err) => (err ? fail(err) : ok())),
  );
}

/** undici connector: blocks non-public IP literals, resolves names through the guard. */
export function createGuardedConnector(resolve?: Resolver): buildConnector.connector {
  const base = buildConnector({ lookup: createGuardedLookup(resolve) });
  return (options, callback) => {
    const host = options.hostname.replace(/^\[|\]$/g, "");
    if (isIP(host) && !isPublicIp(host))
      return callback(new BlockedAddressError(options.hostname), null);
    return base(options, callback);
  };
}

export function createGuardedAgent(resolve?: Resolver): Dispatcher {
  return new Agent({ connect: createGuardedConnector(resolve) });
}

let shared: Dispatcher | undefined;

/** Process-wide guarded dispatcher for direct requests. */
export function guardedDispatcher(): Dispatcher {
  return (shared ??= createGuardedAgent());
}

/** Finds a BlockedAddressError in an error's cause chain (fetch wraps it in TypeError). */
export function findBlockedAddress(error: unknown): BlockedAddressError | null {
  let current: unknown = error;
  for (let i = 0; i < 6 && current; i++) {
    if (current instanceof BlockedAddressError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}
