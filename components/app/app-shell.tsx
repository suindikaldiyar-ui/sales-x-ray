"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, LogOut, ChevronsUpDown, Check, Settings } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { NavIcon } from "./icon";
import { Avatar } from "@/components/ui/avatar";
import { RoleBadge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { signOutAction } from "@/lib/auth/actions";
import { setActiveOrgAction } from "@/lib/tenant/actions";
import type { MembershipRole } from "@/lib/types/db";
import type { NavItem } from "@/lib/nav";

interface ShellProps {
  children: React.ReactNode;
  navItems: NavItem[];
  role: MembershipRole;
  user: { email: string; fullName: string | null };
  org: { id: string; name: string };
  memberships: { id: string; name: string }[];
}

export function AppShell({
  children,
  navItems,
  role,
  user,
  org,
  memberships,
}: ShellProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [orgMenu, setOrgMenu] = useState(false);
  const [userMenu, setUserMenu] = useState(false);

  const nav = (
    <nav className="flex-1 space-y-1 px-3 py-4">
      {navItems.map((item) => {
        const active =
          pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              active
                ? "bg-ink-600 text-content"
                : "text-content-muted hover:bg-ink-700 hover:text-content",
            )}
          >
            <span
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-lg border transition-colors",
                active
                  ? "border-xray/30 bg-xray/10 text-xray"
                  : "border-transparent text-content-faint group-hover:text-content-muted",
              )}
            >
              <NavIcon name={item.icon} className="h-4 w-4" />
            </span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );

  const sidebarInner = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5">
        <Link href="/dashboard" onClick={() => setMobileOpen(false)}>
          <Logo />
        </Link>
      </div>
      <div className="rule mx-4" />
      {nav}
      <div className="rule mx-4" />
      {/* settings link pinned to bottom (visible to everyone) */}
      <div className="px-3 py-3">
        <Link
          href="/settings"
          onClick={() => setMobileOpen(false)}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
            pathname.startsWith("/settings")
              ? "bg-ink-600 text-content"
              : "text-content-muted hover:bg-ink-700 hover:text-content",
          )}
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg text-content-faint">
            <Settings className="h-4 w-4" />
          </span>
          Настройки
        </Link>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-ink-800/80 backdrop-blur-xl lg:block">
        {sidebarInner}
      </aside>

      {/* mobile drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div
            className="absolute inset-0 bg-ink-900/70 backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-ink-800">
            <button
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-4 flex h-9 w-9 items-center justify-center rounded-lg text-content-muted hover:bg-ink-600"
              aria-label="Закрыть меню"
            >
              <X className="h-5 w-5" />
            </button>
            {sidebarInner}
          </aside>
        </div>
      )}

      {/* main column */}
      <div className="flex min-h-screen w-full flex-col lg:pl-64">
        {/* topbar */}
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-ink-900/80 px-4 backdrop-blur-xl sm:px-6">
          <button
            onClick={() => setMobileOpen(true)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-content-muted hover:bg-ink-600 lg:hidden"
            aria-label="Открыть меню"
          >
            <Menu className="h-5 w-5" />
          </button>

          {/* org switcher */}
          <div className="relative">
            <button
              onClick={() => {
                setOrgMenu((v) => !v);
                setUserMenu(false);
              }}
              className="flex items-center gap-2.5 rounded-xl border border-line-strong bg-ink-700/60 px-3 py-2 text-sm transition-colors hover:border-line-strong hover:bg-ink-600"
            >
              <span className="flex h-6 w-6 items-center justify-center rounded-md bg-xray/15 text-[11px] font-bold text-xray">
                {org.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="max-w-[12rem] truncate font-medium text-content">
                {org.name}
              </span>
              <ChevronsUpDown className="h-4 w-4 text-content-faint" />
            </button>

            {orgMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setOrgMenu(false)}
                />
                <div className="absolute left-0 top-full z-20 mt-2 w-64 rounded-xl border border-line-strong bg-ink-700 p-1.5 shadow-panel">
                  <p className="px-2.5 py-1.5 text-xs text-content-faint">
                    Ваши компании
                  </p>
                  {memberships.map((m) => (
                    <form key={m.id} action={setActiveOrgAction}>
                      <input type="hidden" name="organization_id" value={m.id} />
                      <button
                        type="submit"
                        className="flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-content-muted hover:bg-ink-600 hover:text-content"
                      >
                        <span className="truncate">{m.name}</span>
                        {m.id === org.id && (
                          <Check className="h-4 w-4 text-xray" />
                        )}
                      </button>
                    </form>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className="flex-1" />

          {/* user menu */}
          <div className="relative">
            <button
              onClick={() => {
                setUserMenu((v) => !v);
                setOrgMenu(false);
              }}
              className="flex items-center gap-2 rounded-xl px-1.5 py-1.5 transition-colors hover:bg-ink-600"
            >
              <Avatar name={user.fullName} email={user.email} size="sm" />
              <span className="hidden text-sm font-medium text-content sm:block">
                {user.fullName ?? user.email}
              </span>
            </button>

            {userMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setUserMenu(false)}
                />
                <div className="absolute right-0 top-full z-20 mt-2 w-60 rounded-xl border border-line-strong bg-ink-700 p-1.5 shadow-panel">
                  <div className="flex items-center gap-3 px-2.5 py-2.5">
                    <Avatar name={user.fullName} email={user.email} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-content">
                        {user.fullName ?? "Пользователь"}
                      </p>
                      <p className="truncate text-xs text-content-faint">
                        {user.email}
                      </p>
                    </div>
                  </div>
                  <div className="px-2.5 pb-2">
                    <RoleBadge role={role} />
                  </div>
                  <div className="rule mx-1 my-1" />
                  <form action={signOutAction}>
                    <button className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-content-muted hover:bg-ink-600 hover:text-content">
                      <LogOut className="h-4 w-4" />
                      Выйти
                    </button>
                  </form>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mx-auto max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
