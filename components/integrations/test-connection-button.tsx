"use client";

import { useFormState } from "react-dom";
import { PlugZap } from "lucide-react";
import {
  testIntegrationAction,
  type IntegrationActionState,
} from "@/lib/integrations/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";
import type { IntegrationProvider } from "@/lib/types/db";

const initial: IntegrationActionState = {};

export function TestConnectionButton({ provider }: { provider: IntegrationProvider }) {
  const [state, formAction] = useFormState(testIntegrationAction, initial);
  return (
    <form action={formAction} className="space-y-2">
      <input type="hidden" name="provider" value={provider} />
      <SubmitButton variant="outline" size="sm" pendingLabel="Проверяем…">
        <PlugZap className="h-4 w-4" />
        Проверить соединение
      </SubmitButton>
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.message && <Alert tone="success">{state.message}</Alert>}
    </form>
  );
}
