"use client";

import { useFormState } from "react-dom";
import {
  acceptInviteFormAction,
  type ActionState,
} from "@/lib/tenant/actions";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

const initial: ActionState = {};

export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction] = useFormState(acceptInviteFormAction, initial);
  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      {state.error && <Alert tone="error">{state.error}</Alert>}
      <SubmitButton className="w-full" size="lg" pendingLabel="Присоединяемся…">
        Принять приглашение
      </SubmitButton>
    </form>
  );
}
