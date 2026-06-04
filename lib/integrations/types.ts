import type { IntegrationProvider } from "@/lib/types/db";

/** Result of testing or running a sync against a provider. */
export interface SyncResult {
  ok: boolean;
  message: string;
  /** Number of records pulled, when applicable. */
  count?: number;
}

/** Outcome of validating stored credentials against the provider. */
export interface ConnectionCheck {
  connected: boolean;
  message: string;
}

/**
 * Common surface every provider connector implements. The concrete sync logic
 * is added later — for now connectors only describe their shape and validate
 * the config that the Integrations page stores per organization.
 */
export interface IntegrationConnector<TConfig = Record<string, unknown>> {
  provider: IntegrationProvider;
  /** Human label shown in the UI. */
  label: string;
  /** Fields the Integrations form should render. */
  configFields: IntegrationConfigField[];
  /** Validate that a saved config has the required shape. */
  validateConfig(config: Record<string, unknown>): boolean;
  /** Verify the credentials actually work (stubbed until real sync lands). */
  testConnection(config: TConfig): Promise<ConnectionCheck>;
  /** Pull data into our tables (stubbed until real sync lands). */
  sync(organizationId: string, config: TConfig): Promise<SyncResult>;
}

export interface IntegrationConfigField {
  key: string;
  label: string;
  placeholder?: string;
  /** `password` masks the value in the UI. */
  type: "text" | "password" | "url";
  required: boolean;
  help?: string;
}

/** Thrown by connectors when sync is requested before it is implemented. */
export class NotImplementedYet extends Error {
  constructor(provider: IntegrationProvider) {
    super(`Sync for "${provider}" is not implemented yet.`);
    this.name = "NotImplementedYet";
  }
}
