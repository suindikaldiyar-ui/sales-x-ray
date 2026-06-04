import Link from "next/link";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Подтвердите почту — Sales X-Ray" };

export default function VerifyEmailPage({
  searchParams,
}: {
  searchParams: { email?: string };
}) {
  return (
    <div className="panel animate-fade-up p-8 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border border-xray/30 bg-xray/10 text-xray">
        <MailCheck className="h-7 w-7" />
      </div>
      <h1 className="mt-6 font-display text-2xl font-bold tracking-tight">
        Проверьте почту
      </h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-content-muted">
        Мы отправили письмо со ссылкой подтверждения
        {searchParams.email ? (
          <>
            {" "}на <span className="font-medium text-content">{searchParams.email}</span>
          </>
        ) : null}
        . Перейдите по ссылке, чтобы завершить настройку компании.
      </p>
      <Link href="/login" className="mt-7 inline-block">
        <Button variant="outline">Перейти ко входу</Button>
      </Link>
    </div>
  );
}
