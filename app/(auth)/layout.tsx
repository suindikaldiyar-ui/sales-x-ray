import Link from "next/link";
import { Logo } from "@/components/brand/logo";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative flex min-h-screen flex-col">
      <div className="pointer-events-none absolute inset-0 bg-grid-faint [background-size:64px_64px] [mask-image:radial-gradient(60%_50%_at_50%_0%,#000_20%,transparent_100%)]" />
      <header className="relative z-10 mx-auto w-full max-w-6xl px-6 py-6">
        <Link href="/">
          <Logo />
        </Link>
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-6 pb-16">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  );
}
