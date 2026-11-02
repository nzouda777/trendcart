/**
 * Version of a stored page copy (pure): the first 16 hex chars of sha256 over
 * a canonical JSON (object keys sorted at every level, arrays kept in order).
 *
 * GATE 3 binds a page approval to the copy the reviewer saw: the UI sends the
 * version it loaded, and approvePage refuses if the stored copy changed since.
 * A content hash needs no schema change, and any edit or regeneration changes
 * it (an edit that restores the exact same copy is, correctly, the same version).
 */
import { createHash } from "node:crypto";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v !== undefined) out[key] = canonical(v);
    }
    return out;
  }
  return value;
}

/** Stable JSON: same content, same string, whatever the key order. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonical(value)) ?? "null";
}

/** 16 hex chars identifying the stored copy, or null when there is no copy. */
export function pageCopyVersion(copy: unknown): string | null {
  if (copy === null || copy === undefined) return null;
  return createHash("sha256").update(canonicalJson(copy)).digest("hex").slice(0, 16);
}
