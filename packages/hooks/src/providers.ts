/** Contracts injected by the host: model, auth, sinks. The core owns the wiring. */

export interface ModelRequest {
  /** provider-neutral request; the provider contract decides the shape */
  [k: string]: unknown;
}

/** The model-provider contract: a plugin overrides this by name (see 03-contracts). */
export interface ModelProvider {
  complete(request: ModelRequest): Promise<unknown>;
}

/** The auth capability: login(), SSO override for providers (see 03/04 docs). */
export interface AuthProvider {
  login(provider?: string): Promise<{ status: string; [k: string]: unknown }>;
  status(): { loggedIn: boolean; provider?: string };
}

export interface NotifySink {
  (message: string, level: "info" | "warn" | "error", plugin: string): void;
}

export interface TelemetrySink {
  (event: string, data: Record<string, unknown>): void;
}

export interface HooksHostConfig {
  session: { id: string; cwd: string };
  /** fs confinement root; defaults to session.cwd */
  workspaceRoot?: string;
  model?: ModelProvider;
  auth?: AuthProvider;
  notify?: NotifySink;
  telemetry?: TelemetrySink;
  /** session agent controls exposed to plugins as $.agent.compact/clear */
  agent?: {
    compact(reason?: string): Promise<void> | void;
    clear(): Promise<void> | void;
  };
  limits?: {
    fsReadMaxBytes?: number;
    fsWriteMaxBytes?: number;
  };
}
