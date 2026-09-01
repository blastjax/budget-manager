"use client";

import Link from "next/link";
import { useShellLayout } from "@/lib/shellLayoutContext";

function hamburgerIcon() {
  return (
    <span className="flex w-5 flex-col gap-1" aria-hidden>
      <span className="h-0.5 rounded-full bg-current" />
      <span className="h-0.5 rounded-full bg-current" />
      <span className="h-0.5 rounded-full bg-current" />
    </span>
  );
}

export function MobileTopBar() {
  const { mobileNavOpen, setMobileNavOpen, closeMobileNav } = useShellLayout();

  return (
    <header className="fixed left-0 right-0 top-0 z-[55] flex h-14 items-center gap-2 border-b border-zinc-200 bg-zinc-50/95 px-3 pt-[max(0.25rem,env(safe-area-inset-top))] backdrop-blur-md dark:border-zinc-900 dark:bg-zinc-900/70 lg:hidden">
      <button
        type="button"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-zinc-700 transition-colors duration-150 hover:bg-zinc-200/60 dark:text-zinc-200 dark:hover:bg-zinc-800/60"
        aria-label={mobileNavOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={mobileNavOpen}
        aria-controls="mobile-sidebar-nav"
        onClick={() => setMobileNavOpen((o) => !o)}
      >
        {hamburgerIcon()}
      </button>
      <Link
        href="/installments"
        className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight text-zinc-900 dark:text-zinc-50"
        onClick={() => closeMobileNav()}
      >
        Payslip & installments
      </Link>
    </header>
  );
}
