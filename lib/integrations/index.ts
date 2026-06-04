import "server-only";
import type { IntegrationProvider } from "@/lib/types/db";
import type { IntegrationConnector } from "./types";
import { amocrm } from "./amocrm";
import { wazzup } from "./wazzup";
import { sipuni } from "./sipuni";
import { telegram } from "./telegram";

/** Server-side registry of provider connectors, keyed by provider. */
export const connectors: Record<IntegrationProvider, IntegrationConnector<any>> = {
  amocrm,
  wazzup,
  sipuni,
  telegram,
};

export function getConnector(provider: IntegrationProvider) {
  return connectors[provider];
}

export * from "./types";
