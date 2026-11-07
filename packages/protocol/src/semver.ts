/** Semver helpers for the versioned wire protocol. */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

const RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/;

export function parseSemVer(s: string): SemVer | undefined {
  const m = RE.exec(s);
  if (!m) return undefined;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

export function formatSemVer(v: SemVer): string {
  return `${v.major}.${v.minor}.${v.patch}`;
}

/**
 * Negotiate a protocol version (LSP-style).
 * Rule ("don't break renderers"):
 *  - different major            -> incompatible, handshake fails;
 *  - same major, differ on minor -> negotiate to the lower minor;
 *  - patch is always compatible.
 */
export function negotiate(
  local: SemVer,
  remote: SemVer,
): { ok: true; version: SemVer } | { ok: false; reason: string } {
  if (local.major !== remote.major) {
    return {
      ok: false,
      reason: `protocol major mismatch: local ${local.major}, remote ${remote.major}`,
    };
  }
  return { ok: true, version: { major: local.major, minor: Math.min(local.minor, remote.minor), patch: 0 } };
}
