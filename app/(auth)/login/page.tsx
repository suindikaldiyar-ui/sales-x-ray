import Link from "next/link";
import { LoginForm } from "./login-form";

export const metadata = { title: "Вход — Sales X-Ray" };

export default function LoginPage({
  searchParams,
}: {
  searchParams: { redirectTo?: string };
}) {
  return (
    <div className="panel animate-fade-up p-7 sm:p-8">
      <h1 className="font-display text-2xl font-bold tracking-tight">
        С возвращением
      </h1>
      <p className="mt-1.5 text-sm text-content-muted">
        Войдите, чтобы открыть рентген продаж.
      </p>

      <div className="mt-7">
        <LoginForm redirectTo={searchParams.redirectTo} />
      </div>

      <p className="mt-6 text-center text-sm text-content-muted">
        Нет аккаунта?{" "}
        <Link href="/register" className="font-medium text-xray hover:underline">
          Зарегистрироваться
        </Link>
      </p>
    </div>
  );
}
