"use client";

import { useFormState } from "react-dom";
import { registerAction, type AuthState } from "@/lib/auth/actions";
import { Field, Input } from "@/components/ui/field";
import { SubmitButton } from "@/components/ui/submit-button";
import { Alert } from "@/components/ui/alert";

const initial: AuthState = {};

export function RegisterForm() {
  const [state, formAction] = useFormState(registerAction, initial);

  return (
    <form action={formAction} className="space-y-4">
      {state.error && <Alert tone="error">{state.error}</Alert>}

      <Field label="Ваше имя" htmlFor="full_name">
        <Input id="full_name" name="full_name" placeholder="Иван Петров" required />
      </Field>

      <Field
        label="Название компании"
        htmlFor="org_name"
        hint="Создадим вашу организацию — вы станете её владельцем."
      >
        <Input id="org_name" name="org_name" placeholder="Автосалон «Прайм»" required />
      </Field>

      <Field label="Рабочий email" htmlFor="email">
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@company.kz"
          required
        />
      </Field>

      <Field label="Пароль" htmlFor="password" hint="Минимум 8 символов.">
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          placeholder="••••••••"
          minLength={8}
          required
        />
      </Field>

      <SubmitButton className="w-full" size="lg" pendingLabel="Создаём аккаунт…">
        Создать аккаунт
      </SubmitButton>
    </form>
  );
}
