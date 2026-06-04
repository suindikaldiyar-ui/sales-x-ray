import Link from "next/link";
import {
  ArrowRight,
  Activity,
  Filter,
  MessagesSquare,
  PhoneCall,
  Send,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { getUser } from "@/lib/auth";

const FEATURES = [
  {
    icon: Filter,
    title: "Рентген воронки",
    text: "Видно, на каком этапе теряются сделки и где утекают деньги — простым языком.",
  },
  {
    icon: MessagesSquare,
    title: "Анализ переписки",
    text: "Вся переписка менеджеров в одном месте. Кто отвечает быстро, а кто сливает клиента.",
  },
  {
    icon: PhoneCall,
    title: "Контроль звонков",
    text: "Звонки и записи рядом со сделками. Пропущенные, недозвоны, длительность.",
  },
  {
    icon: Send,
    title: "Отчёты в Telegram",
    text: "Короткий отчёт по продажам руководителю каждое утро — без захода в систему.",
  },
];

const STEPS = [
  { n: "01", title: "Подключите amoCRM", text: "Один токен — и сделки начинают синхронизироваться." },
  { n: "02", title: "Добавьте команду", text: "Пригласите РОПов и менеджеров. У каждого своя роль и доступ." },
  { n: "03", title: "Смотрите рентген", text: "Дашборд, воронка и ежедневные отчёты собираются автоматически." },
];

export default async function LandingPage() {
  const user = await getUser();
  const primaryHref = user ? "/dashboard" : "/register";
  const primaryLabel = user ? "Открыть дашборд" : "Начать бесплатно";

  return (
    <div className="relative min-h-screen overflow-hidden">
      {/* atmospheric grid */}
      <div className="pointer-events-none absolute inset-0 bg-grid-faint [background-size:64px_64px] [mask-image:radial-gradient(70%_60%_at_50%_0%,#000_30%,transparent_100%)]" />

      {/* ── Nav ──────────────────────────────────────────────── */}
      <header className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <nav className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Войти
            </Button>
          </Link>
          <Link href={primaryHref}>
            <Button size="sm">
              {user ? "Дашборд" : "Регистрация"}
            </Button>
          </Link>
        </nav>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 pb-20 pt-16 text-center sm:pt-24">
        <div className="animate-fade-up [animation-delay:60ms]">
          <span className="eyebrow inline-flex items-center gap-2 rounded-full border border-line-strong bg-ink-700/60 px-3 py-1">
            <Activity className="h-3.5 w-3.5 text-xray" />
            Аналитика отдела продаж
          </span>
        </div>

        <h1 className="mx-auto mt-7 max-w-4xl animate-fade-up font-display text-4xl font-extrabold leading-[1.05] tracking-tight [animation-delay:120ms] sm:text-6xl">
          Рентген вашего <span className="text-gradient">отдела продаж</span>
        </h1>

        <p className="mx-auto mt-6 max-w-2xl animate-fade-up text-lg leading-relaxed text-content-muted [animation-delay:180ms]">
          Sales X-Ray собирает сделки, переписку и звонки из amoCRM, Wazzup и
          Sipuni — и показывает простым языком, где теряются деньги и как
          вырасти. Для автосалонов и любых отделов продаж.
        </p>

        <div className="mt-9 flex animate-fade-up flex-col items-center justify-center gap-3 [animation-delay:240ms] sm:flex-row">
          <Link href={primaryHref}>
            <Button size="lg" className="group">
              {primaryLabel}
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link>
          <Link href="/login">
            <Button size="lg" variant="outline">
              У меня уже есть аккаунт
            </Button>
          </Link>
        </div>

        <p className="mt-5 flex animate-fade-up items-center justify-center gap-2 text-xs text-content-faint [animation-delay:300ms]">
          <ShieldCheck className="h-3.5 w-3.5" />
          Данные каждой компании изолированы. Ключи хранятся только на сервере.
        </p>

        {/* dashboard preview */}
        <div className="relative mx-auto mt-16 max-w-4xl animate-fade-up [animation-delay:360ms]">
          <div className="absolute -inset-x-10 -top-10 h-40 bg-radial-glow blur-2xl" />
          <DashboardPreview />
        </div>
      </section>

      {/* ── Features ─────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-20">
        <div className="mb-12 text-center">
          <p className="eyebrow">Что внутри</p>
          <h2 className="mt-3 font-display text-3xl font-bold tracking-tight">
            Четыре источника правды о продажах
          </h2>
        </div>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="panel group p-6 transition-colors hover:border-xray/30"
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-xray/25 bg-xray/10 text-xray transition-transform group-hover:scale-105">
                <f.icon className="h-5 w-5" />
              </div>
              <h3 className="mt-5 font-display text-lg font-semibold">
                {f.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-content-muted">
                {f.text}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ─────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-6xl px-6 py-16">
        <div className="panel overflow-hidden p-8 sm:p-12">
          <div className="mb-10 flex items-center gap-3">
            <TrendingUp className="h-5 w-5 text-xray" />
            <p className="eyebrow">Запуск за три шага</p>
          </div>
          <div className="grid gap-8 sm:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="relative">
                <span className="font-mono text-3xl font-bold text-xray/30">
                  {s.n}
                </span>
                <h3 className="mt-3 font-display text-lg font-semibold">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-content-muted">
                  {s.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ──────────────────────────────────────────────── */}
      <section className="relative z-10 mx-auto max-w-3xl px-6 py-24 text-center">
        <h2 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
          Сделайте продажи прозрачными
        </h2>
        <p className="mx-auto mt-4 max-w-xl text-content-muted">
          Заведите компанию за минуту. Подключение интеграций — когда будете
          готовы.
        </p>
        <Link href={primaryHref} className="mt-8 inline-block">
          <Button size="lg">
            {primaryLabel}
            <ArrowRight className="h-4 w-4" />
          </Button>
        </Link>
      </section>

      <footer className="relative z-10 border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 py-8 text-sm text-content-faint sm:flex-row">
          <Logo />
          <p>© {new Date().getFullYear()} Sales X-Ray. Все права защищены.</p>
        </div>
      </footer>
    </div>
  );
}

function DashboardPreview() {
  const metrics = [
    { label: "Лидов", value: "1 248", tone: "text-content" },
    { label: "Конверсия", value: "23.4%", tone: "text-xray" },
    { label: "Выиграно", value: "292", tone: "text-signal-good" },
    { label: "Упущено", value: "₸ 18.6М", tone: "text-signal-bad" },
  ];
  const stages = [72, 58, 41, 33, 23];
  return (
    <div className="panel relative overflow-hidden p-5 text-left sm:p-7">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full bg-signal-bad/60" />
          <span className="h-3 w-3 rounded-full bg-signal-warn/60" />
          <span className="h-3 w-3 rounded-full bg-signal-good/60" />
        </div>
        <span className="rounded-full border border-line-strong bg-ink-700 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-content-faint">
          превью
        </span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="panel-flat p-3.5">
            <p className="text-[11px] text-content-faint">{m.label}</p>
            <p className={`nums mt-1 font-display text-xl font-bold ${m.tone}`}>
              {m.value}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-4 panel-flat p-4">
        <p className="eyebrow mb-3">Воронка</p>
        <div className="flex items-end gap-2.5">
          {stages.map((h, i) => (
            <div key={i} className="flex flex-1 flex-col items-center gap-2">
              <div
                className="w-full rounded-md bg-gradient-to-t from-xray/20 to-xray/60"
                style={{ height: `${h * 1.4}px` }}
              />
              <span className="nums text-[10px] text-content-faint">{h}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
