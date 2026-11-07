import { negotiate, parseSemVer } from "./semver.js";
import type { HelloMessage, HelloAckMessage } from "./messages.js";

export const PROTOCOL_NAME = "agent-compositor";
/** bump following semver: major = breaking frame/shape change */
export const PROTOCOL_VERSION = "0.1.0";

/** Build the opening message for a peer. */
export function hello(role: HelloMessage["role"], capabilities: HelloMessage["capabilities"]): HelloMessage {
  return { type: "hello", protocol: PROTOCOL_NAME, version: PROTOCOL_VERSION, role, capabilities };
}

/** Answer a peer's hello (LSP-style capability + version negotiation). */
export function answerHello(local: HelloMessage, remote: HelloMessage): HelloAckMessage {
  if (remote.protocol !== PROTOCOL_NAME) {
    return { type: "hello-ack", ok: false, reason: `unknown protocol "${remote.protocol}"` };
  }
  const localV = parseSemVer(local.version);
  const remoteV = parseSemVer(remote.version);
  if (!localV || !remoteV) {
    return { type: "hello-ack", ok: false, reason: "unparseable version" };
  }
  const n = negotiate(localV, remoteV);
  if (!n.ok) {
    return { type: "hello-ack", ok: false, reason: n.reason };
  }
  const negotiated: HelloAckMessage = { type: "hello-ack", ok: true, version: `${n.version.major}.${n.version.minor}.0` };
  // Surface intersection: if they share nothing drawable, the session is pointless.
  const shared = local.capabilities.surfaces.filter((s) => remote.capabilities.surfaces.includes(s));
  if (shared.length === 0) {
    return { type: "hello-ack", ok: false, reason: "no shared surfaces" };
  }
  return negotiated;
}
