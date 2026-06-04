import "server-only";
import type { IntegrationConnector, ConnectionCheck, SyncResult } from "./types";
import { NotImplementedYet } from "./types";

export interface TelegramConfig {
  bot_token: string;
  chat_id: string;
}

/**
 * Telegram connector (outbound daily report digests). Stub — validates and
 * stores config; real delivery added later alongside daily_reports.
 */
export const telegram: IntegrationConnector<TelegramConfig> = {
  provider: "telegram",
  label: "Telegram",
  configFields: [
    {
      key: "bot_token",
      label: "Токен бота",
      placeholder: "123456:ABC-DEF…",
      type: "password",
      required: true,
      help: "Создайте бота через @BotFather и вставьте его токен.",
    },
    {
      key: "chat_id",
      label: "ID чата / канала",
      placeholder: "-1001234567890",
      type: "text",
      required: true,
      help: "Куда присылать ежедневные отчёты.",
    },
  ],
  validateConfig(config): boolean {
    return (
      typeof config.bot_token === "string" &&
      config.bot_token.length > 0 &&
      typeof config.chat_id === "string" &&
      config.chat_id.length > 0
    );
  },
  async testConnection(): Promise<ConnectionCheck> {
    return {
      connected: false,
      message: "Проверка соединения появится вместе с отправкой отчётов.",
    };
  },
  async sync(): Promise<SyncResult> {
    throw new NotImplementedYet("telegram");
  },
};
