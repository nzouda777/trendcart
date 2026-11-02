/**
 * Host checks for URLs users configure (brand proxies). Pure.
 *
 * Proxies are often IP literals, so public IPs are allowed; loopback,
 * private, link-local, CGNAT, multicast/reserved addresses, localhost and
 * internal names are not. DNS names that resolve to private addresses are
 * a connect-time concern (QA S3), not checked here.
 */

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".lan",
  ".home",
  ".corp",
  ".intranet",
];

function ipv4Octets(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const octets = m.slice(1).map(Number);
  return octets.every((o) => o <= 255) ? octets : null;
}

function isBlockedIpv4([a, b]: number[]): boolean {
  return (
    a === 0 || // "this" network
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local, cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) || // 192.0.0/24 protocol assignments (and 192.0.2 docs)
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast and reserved
  );
}

function isBlockedIpv6(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h === "::" ||
    h === "::1" ||
    h.startsWith("::ffff:") || // IPv4-mapped: judge the IPv4 form instead
    /^f[cd]/.test(h) || // unique local fc00::/7
    /^fe[89ab]/.test(h) || // link-local fe80::/10
    h.startsWith("ff") // multicast
  );
}

/**
 * True when `hostname` (as found in a URL, IPv6 in brackets) is a public
 * host. Numeric IPv4 shorthands ("2130706433", "0x7f000001") are normalised
 * through the WHATWG http parser first, because non-special schemes such as
 * socks5:// leave them as-is.
 */
export function isPublicHost(hostname: string): boolean {
  let host = hostname.toLowerCase().replace(/\.$/, "");
  if (!host) return false;

  if (host.startsWith("[")) return !isBlockedIpv6(host.slice(1, -1));

  try {
    host = new URL(`http://${host}/`).hostname;
  } catch {
    return false;
  }
  if (host.startsWith("[")) return !isBlockedIpv6(host.slice(1, -1));

  const v4 = ipv4Octets(host);
  if (v4) return !isBlockedIpv4(v4);

  if (host === "localhost" || !host.includes(".")) return false;
  return !BLOCKED_SUFFIXES.some((s) => host.endsWith(s));
}
