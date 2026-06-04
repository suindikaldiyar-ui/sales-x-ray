"use client";

import { useFormState } from "react-dom";
import { loginAction, type AuthState } from "@/lib/auth/actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

const initial: AuthState = {};

export function LoginForm({ redirectTo }: { redirectTo?: string }) {
  const [state, formAction] = useFormState(loginAction, initial);

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="redirectTo" value={redirectTo ?? ""} />
      {state.error && <Alert tone="error">{state.error}</Alert>}

      <Field label="Email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.kz"
          required
        />
      </Field>

      <Field label="Пароль" htmlFor="password">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          placeholder="••••••••"
          required
        />
      </Field>

      <SubmitButton className="w-full" size="lg" pendingLabel="Входим…">
        Войти
      </SubmitButton>
    </form>
  );
}
