"use client";

import { useFormState } from "react-dom";
import {
  createOrganizationAction,
  type ActionState,
} from "@/lib/tenant/actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

const initial: ActionState = {};

export function CreateOrgForm({ defaultName }: { defaultName?: string }) {
  const [state, formAction] = useFormState(createOrganizationAction, initial);
  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <Field
        label="Название компании"
        htmlFor="org_name"
        hint="Можно изменить позже в настройках."
      >
        <Input
          id="org_name"
          name="org_name"
          defaultValue={defaultName}
          placeholder="Автосалон «Прайм»"
          required
          autoFocus
        />
      </Field>
      <SubmitButton className="w-full" size="lg" pendingLabel="Создаём…">
        Создать компанию
      </SubmitButton>
    </form>
  );
}
