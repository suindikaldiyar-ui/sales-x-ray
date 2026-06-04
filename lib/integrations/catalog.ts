import type { IntegrationProvider } from "@/lib/types/db";
import type { IntegrationConfigField } from "./types";

/**
 * Client-safe catalog describing each provider for the Integrations UI.
 * (No `server-only` import here, so it is usable in client components.)
 * Secret values are never sent back to the browser — the form only renders
 * these fields and whether a value is already stored.
 */
export interface ProviderCatalogEntry {
  provider: IntegrationProvider;
  label: string;
  tagline: string;
  description: string;
  /** lucide-react icon name rendered by the page. */
  category: "CRM" | "Чаты" | "Телефония" | "Уведомления";
  configFields: IntegrationConfigField[];
  docsUrl?: string;
}

export const INTEGRATION_CATALOG: ProviderCatalogEntry[] = [
  {
    provider: "amocrm",
    label: "amoCRM",
    tagline: "Сделки и воронки",
    description:
      "Источник воронки продаж: сделки, этапы, ответственные. Основа всей аналитики.",
    category: "CRM",
    configFields: [
      { key: "base_url", label: "Адрес аккаунта", placeholder: "https://mycompany.amocrm.ru", type: "url", required: true, help: "Домен вашего портала amoCRM." },
      { key: "access_token", label: "Долгоживущий токен", placeholder: "eyJ0eXAiOiJKV1Qi…", type: "password", required: true, help: "Настройки → Интеграции → Ключи и доступы." },
    ],
    docsUrl: "https://www.amocrm.ru/developers/content/oauth/step-by-step",
  },
  {
    provider: "wazzup",
    label: "Wazzup",
    tagline: "Переписка с клиентами",
    description:
      "WhatsApp, Instagram и Telegram-чаты менеджеров. Источник переписок для анализа.",
    category: "Чаты",
    configFields: [
      { key: "api_key", label: "API-ключ", placeholder: "Ключ из личного кабинета Wazzup", type: "password", required: true, help: "Настройки → Интеграции → API." },
    ],
    docsUrl: "https://wazzup24.com",
  },
  {
    provider: "sipuni",
    label: "Sipuni",
    tagline: "Звонки и записи",
    description:
      "Телефония: входящие и исходящие звонки с записями для анализа разговоров.",
    category: "Телефония",
    configFields: [
      { key: "user_id", label: "ID пользователя", placeholder: "Например: 100500", type: "text", required: true },
      { key: "api_key", label: "API-ключ", placeholder: "Ключ интеграции Sipuni", type: "password", required: true, help: "Профиль → Интеграция → API." },
    ],
    docsUrl: "https://sipuni.com",
  },
  {
    provider: "telegram",
    label: "Telegram",
    tagline: "Ежедневные отчёты",
    description:
      "Бот присылает руководителю короткий отчёт по продажам каждый день.",
    category: "Уведомления",
    configFields: [
      { key: "bot_token", label: "Токен бота", placeholder: "123456:ABC-DEF…", type: "password", required: true, help: "Создайте бота через @BotFather." },
      { key: "chat_id", label: "ID чата / канала", placeholder: "-1001234567890", type: "text", required: true, help: "Куда присылать отчёты." },
    ],
    docsUrl: "https://core.telegram.org/bots",
  },
];

export function getCatalogEntry(provider: IntegrationProvider) {
  return INTEGRATION_CATALOG.find((e) => e.provider === provider);
}
