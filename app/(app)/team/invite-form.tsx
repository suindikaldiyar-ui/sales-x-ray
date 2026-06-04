"use client";

import { useEffect, useRef } from "react";
import { useFormState } from "react-dom";
import { UserPlus } from "lucide-react";
import { inviteMemberAction, type ActionState } from "@/lib/tenant/actions";
import { Field, Input, Select } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

const initial: ActionState = {};

export function InviteForm() {
  const [state, formAction] = useFormState(inviteMemberAction, initial);
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.message) formRef.current?.reset();
  }, [state.message]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      {state.error && <Alert tone="error">{state.error}</Alert>}
      {state.message && <Alert tone="success">{state.message}</Alert>}

      <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field label="Email сотрудника" htmlFor="invite-email">
          <Input
            id="invite-email"
            name="email"
            type="email"
            placeholder="manager@company.kz"
            required
          />
        </Field>
        <Field label="Роль" htmlFor="invite-role" className="sm:w-40">
          <Select id="invite-role" name="role" defaultValue="MOP">
            <option value="MOP">Менеджер</option>
            <option value="ROP">РОП</option>
          </Select>
        </Field>
        <SubmitButton className="sm:mb-0">
          <UserPlus className="h-4 w-4" />
          Пригласить
        </SubmitButton>
      </div>
    </form>
  );
}
