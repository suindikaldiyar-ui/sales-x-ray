import Link from "next/link";
import { RegisterForm } from "./register-form";

export const metadata = { title: "Регистрация — Sales X-Ray" };

export default function RegisterPage() {
  return (
    <div className="panel animate-fade-up p-7 sm:p-8">
      <h1 className="font-display text-2xl font-bold tracking-tight">
        Создайте компанию
      </h1>
      <p className="mt-1.5 text-sm text-content-muted">
        Минута на регистрацию — интеграции подключите позже.
      </p>

      <div className="mt-7">
        <RegisterForm />
      </div>

      <p className="mt-6 text-center text-sm text-content-muted">
        Уже есть аккаунт?{" "}
        <Link href="/login" className="font-medium text-xray hover:underline">
          Войти
        </Link>
      </p>
    </div>
  );
}
