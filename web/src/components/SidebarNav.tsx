"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
const sidebarNavInactiveHover =
  "transition-colors duration-150 hover:bg-zinc-200/60 dark:hover:bg-zinc-800/60";
import { dataApiBase } from "@/lib/api";
import { clearSessionToken, getSessionToken } from "@/lib/auth";
import { useShellLayout } from "@/lib/shellLayoutContext";
import { ICON_BUTTON_CLASSES, SECONDARY_BUTTON_CLASSES } from "@/lib/ui";
import { useLgUp } from "@/lib/useLgUp";

type NavLink = { href: string; label: string; indent?: boolean };

/** Other routes still exist; only these appear in the shell nav. */
const NAV_SEGMENTS: readonly { title: string | null; links: readonly NavLink[] }[] = [
  {
    title: "Finances",
    links: [
      { href: "/calendar", label: "Calendar" },
      { href: "/monthly-expenses", label: "Monthly Expenses", indent: true },
      { href: "/credit-card", label: "Credit Card", indent: true },
      { href: "/installments", label: "Installments", indent: true },
      { href: "/house-payments", label: "House Payments", indent: true },
      { href: "/payslip", label: "Payslip" },
      { href: "/commission", label: "Commission", indent: true },
      { href: "/salary-stats", label: "Salary Stats", indent: true },
    ],
  },
  {
    title: "Health",
    links: [{ href: "/blood-pressure", label: "Overall Health" }],
  },
  {
    title: "Travels",
    links: [{ href: "/travels", label: "Travels" }],
  },
  {
    title: "Games",
    links: [
      { href: "/games/mosaic", label: "Mosaic" },
      { href: "/games/mambo", label: "Mambo" },
      { href: "/games/mastermind", label: "Mastermind" },
      { href: "/games/sets", label: "Sets" },
      { href: "/lotto", label: "Lotto" },
    ],
  },
  {
    title: null,
    links: [{ href: "/settings", label: "Settings" }],
  },
];

const LINKS: readonly NavLink[] = NAV_SEGMENTS.flatMap((s) => s.links);

function matchingNavHref(
  pathname: string,
  links: readonly { href: string }[],
): string {
  const sorted = [...links].sort((a, b) => b.href.length - a.href.length);
  for (const { href } of sorted) {
    if (pathname === href) return href;
    if (pathname.startsWith(`${href}/`)) return href;
  }
  return "";
}

export function SidebarNav() {
  const pathname = usePathname();
  const lgUp = useLgUp();
  const { leftWidth, mobileNavOpen, closeMobileNav } = useShellLayout();
  // Set only when a login session is actually active — this component only
  // ever mounts once AuthGate has already decided the app is reachable
  // (login not required, or required and satisfied), so this value is
  // correct for the component's whole lifetime.
  const [hasSession] = useState(() => getSessionToken() !== null);

  useEffect(() => {
    closeMobileNav();
  }, [pathname, closeMobileNav]);

  const activeHref = matchingNavHref(pathname, LINKS);

  async function handleLogout() {
    const token = getSessionToken();
    try {
      await fetch(`${dataApiBase()}/api/auth/logout`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      });
    } catch {
      /* best effort — clear the local token and reload regardless */
    }
    clearSessionToken();
    window.location.reload();
  }

  return (
    <aside
      id="mobile-sidebar-nav"
      suppressHydrationWarning
      style={lgUp ? { width: leftWidth, flexShrink: 0 } : undefined}
      className={[
        "w-[min(18rem,88vw)] max-lg:max-w-[88vw]",
        "flex flex-col overflow-hidden border-r border-zinc-200 bg-zinc-50/90 dark:border-zinc-900 dark:bg-zinc-900/60",
        "max-lg:fixed max-lg:left-0 max-lg:top-14 max-lg:z-[52] max-lg:h-[calc(100dvh-3.5rem)] max-lg:max-h-[calc(100dvh-3.5rem)] max-lg:shadow-xl dark:max-lg:shadow-none dark:max-lg:ring-1 dark:max-lg:ring-white/10 max-lg:transition-transform max-lg:duration-200 max-lg:ease-out",
        mobileNavOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full",
        "lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:max-h-[100dvh] lg:translate-x-0 lg:shadow-none",
      ].join(" ")}
    >
      <div className="flex min-h-0 min-w-0 flex-1 flex-col px-3 py-5 sm:px-4">
        <div className="flex shrink-0 items-center justify-end gap-1 lg:hidden">
          <button
            type="button"
            className={ICON_BUTTON_CLASSES}
            aria-label="Close menu"
            onClick={closeMobileNav}
          >
            <span className="leading-none" aria-hidden>
              ✕
            </span>
          </button>
        </div>

        <nav
          className="mt-4 flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden lg:mt-0"
          aria-label="Main"
        >
          {NAV_SEGMENTS.map((segment, segmentIndex) => (
            <div
              key={segment.title ?? `segment-${segmentIndex}`}
              className="flex flex-col gap-0.5"
            >
              {segment.title ? (
                <h2 className="px-3 pb-1 text-xs font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  {segment.title}
                </h2>
              ) : null}
              {segment.links.map(({ href, label, indent }) => {
                const active = activeHref === href;
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={closeMobileNav}
                    className={`rounded-md py-2 text-sm ${
                      indent ? "pl-6 pr-3" : "px-3"
                    } ${
                      active
                        ? "bg-zinc-200/70 font-medium text-zinc-900 dark:bg-zinc-800/70 dark:text-zinc-50"
                        : `font-normal text-zinc-700 dark:text-zinc-300 ${sidebarNavInactiveHover}`
                    }`}
                  >
                    {label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        {hasSession && (
          <div className="mt-2 shrink-0 border-t border-zinc-200 pt-3 dark:border-zinc-900">
            <button
              type="button"
              onClick={handleLogout}
              className={`w-full ${SECONDARY_BUTTON_CLASSES}`}
            >
              Log out
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
