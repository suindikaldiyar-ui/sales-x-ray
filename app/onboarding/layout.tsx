import { Logo } from "@/components/brand/logo";
import { signOutAction } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth";

export default async function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireUser();
  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="pointer-events-none absolute inset-0 bg-grid-faint [background-size:64px_64px] [mask-image:radial-gradient(60%_50%_at_50%_0%,#000_20%,transparent_100%)]" />
      <header className="relative z-10 mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <Logo />
        <form action={signOutAction}>
          <button className="text-sm text-content-muted transition-colors hover:text-content">
            Выйти
          </button>
        </form>
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-lg">{children}</div>
      </main>
    </div>
  );
}
