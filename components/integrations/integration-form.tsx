"use client";

import { useFormState } from "react-dom";
import {
  saveIntegrationAction,
  type IntegrationActionState,
} from "@/lib/integrations/actions";
import type { ProviderCatalogEntry } from "@/lib/integrations/catalog";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

const initial: IntegrationActionState = {};

/**
 * Renders the credential fields for one provider. Secrets that are already
 * stored are shown as masked placeholders (•••••) and only overwritten when a
 * new value is typed — the actual secret is never sent to the browser.
 */
export function IntegrationForm({
  entry,
  storedKeys = [],
  submitLabel = "Сохранить",
}: {
  entry: ProviderCatalogEntry;
  storedKeys?: string[];
  submitLabel?: string;
}) {
  const [state, formAction] = useFormState(saveIntegrationAction, initial);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="provider" value={entry.provider} />
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.message && <Alert tone="success">{state.message}</Alert>}

      {entry.configFields.map((field) => {
        const stored = storedKeys.includes(field.key);
        const isSecret = field.type === "password";
        return (
          <Field
            key={field.key}
            label={field.label}
            htmlFor={`${entry.provider}-${field.key}`}
            hint={
              isSecret && stored
                ? "Сохранено. Оставьте пустым, чтобы не менять."
                : field.help
            }
          >
            <Input
              id={`${entry.provider}-${field.key}`}
              name={field.key}
              type={isSecret ? "password" : field.type === "url" ? "url" : "text"}
              placeholder={isSecret && stored ? "••••••••••••" : field.placeholder}
              required={field.required && !(isSecret && stored)}
            />
          </Field>
        );
      })}

      <SubmitButton className="w-full">{submitLabel}</SubmitButton>
    </form>
  );
}
