"use client";

import { useState } from "react";
import { useFormState } from "react-dom";
import { Sparkles } from "lucide-react";
import { saveAiSettingsAction, type AiSettingsState } from "@/lib/ai/actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";

const initial: AiSettingsState = {};

export function AiSettingsCard({
  enabled,
  hasKey,
  usingGlobalKey,
  model,
}: {
  enabled: boolean;
  hasKey: boolean;
  usingGlobalKey: boolean;
  model: string;
}) {
  const [state, formAction] = useFormState(saveAiSettingsAction, initial);
  const [on, setOn] = useState(enabled);

  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.message && <Alert tone="success">{state.message}</Alert>}

      {/* toggle */}
      <div className="flex items-center justify-between rounded-xl border border-line bg-ink-700/40 p-3.5">
        <div>
          <p className="text-sm font-medium text-content">AI-анализ включён</p>
          <p className="text-xs text-content-faint">Выключите, чтобы не тратить квоту Gemini.</p>
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            name="enabled"
            checked={on}
            onChange={(e) => setOn(e.target.checked)}
            className="peer sr-only"
          />
          <span className="h-6 w-11 rounded-full bg-ink-500 transition-colors peer-checked:bg-xray/70" />
          <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-content transition-transform peer-checked:translate-x-5" />
        </label>
      </div>

      <Field
        label="Gemini API-ключ (этой компании)"
        htmlFor="gemini_api_key"
        hint={
          hasKey
            ? usingGlobalKey
              ? "Сейчас используется общий ключ сервера. Можно задать свой."
              : "Ключ сохранён. Оставьте пустым, чтобы не менять."
            : "aistudio.google.com/app/apikey — ключ хранится на сервере, в браузер не передаётся."
        }
      >
        <Input
          id="gemini_api_key"
          name="gemini_api_key"
          type="password"
          placeholder={hasKey && !usingGlobalKey ? "••••••••••••" : "AIza…"}
          autoComplete="off"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2 text-xs text-content-faint">
        <span className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-xray" />
          Модель:
        </span>
        <Badge tone="xray">{model}</Badge>
        {hasKey ? (
          <Badge tone="good">ключ есть</Badge>
        ) : (
          <Badge tone="warn">ключ не задан</Badge>
        )}
      </div>

      <SubmitButton size="sm">Сохранить настройки AI</SubmitButton>
    </form>
  );
}
