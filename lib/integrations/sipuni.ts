import "server-only";
import type { IntegrationConnector, ConnectionCheck, SyncResult } from "./types";
import { NotImplementedYet } from "./types";

export interface SipuniConfig {
  user_id: string;
  api_key: string;
}

/**
 * Sipuni connector (telephony: calls + recordings → calls table).
 * Stub — validates and stores config; real sync added later.
 */
export const sipuni: IntegrationConnector<SipuniConfig> = {
  provider: "sipuni",
  label: "Sipuni",
  configFields: [
    {
      key: "user_id",
      label: "ID пользователя",
      placeholder: "Например: 100500",
      type: "text",
      required: true,
    },
    {
      key: "api_key",
      label: "API-ключ",
      placeholder: "Ключ интеграции Sipuni",
      type: "password",
      required: true,
      help: "Профиль → Интеграция → API в кабинете Sipuni.",
    },
  ],
  validateConfig(config): boolean {
    return (
      typeof config.user_id === "string" &&
      config.user_id.length > 0 &&
      typeof config.api_key === "string" &&
      config.api_key.length > 0
    );
  },
  async testConnection(): Promise<ConnectionCheck> {
    return {
      connected: false,
      message: "Проверка соединения появится вместе с синхронизацией.",
    };
  },
  async sync(): Promise<SyncResult> {
    throw new NotImplementedYet("sipuni");
  },
};
