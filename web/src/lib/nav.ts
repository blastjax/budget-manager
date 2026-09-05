/**
 * The shell's navigation map — one source of truth for the sidebar tree, the
 * header's quick search, and the breadcrumb each page shows.
 *
 * Other routes still exist; only what's listed here is navigable from chrome.
 */

import {
  CalendarIcon,
  ChartBarIcon,
  CreditCardIcon,
  DiceIcon,
  DocumentIcon,
  GridIcon,
  HeartPulseIcon,
  HomeIcon,
  LayersIcon,
  MusicIcon,
  PlaneIcon,
  PuzzleIcon,
  SettingsIcon,
  TicketIcon,
  TrendingUpIcon,
  WalletIcon,
  type IconProps,
} from "@/components/Icons";

export type NavIcon = (p: IconProps) => React.ReactElement;
export type NavChild = { href: string; label: string; icon: NavIcon };
export type NavItem = {
  href: string;
  label: string;
  icon: NavIcon;
  children?: readonly NavChild[];
};
export type NavSection = { title: string | null; items: readonly NavItem[] };

/**
 * Sub-pages hang off the page they belong to rather than sitting at the same
 * level behind an indent, so the tree collapses to just the section you're in.
 */
export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: "Finances",
    items: [
      {
        href: "/calendar",
        label: "Calendar",
        icon: CalendarIcon,
        children: [
          {
            href: "/monthly-expenses",
            label: "Monthly Expenses",
            icon: WalletIcon,
          },
          { href: "/credit-card", label: "Credit Card", icon: CreditCardIcon },
          { href: "/installments", label: "Installments", icon: LayersIcon },
          { href: "/house-payments", label: "House Payments", icon: HomeIcon },
        ],
      },
      {
        href: "/payslip",
        label: "Payslip",
        icon: DocumentIcon,
        children: [
          { href: "/commission", label: "Commission", icon: TrendingUpIcon },
          { href: "/salary-stats", label: "Salary Stats", icon: ChartBarIcon },
        ],
      },
    ],
  },
  {
    title: "Health",
    items: [
      {
        href: "/blood-pressure",
        label: "Overall Health",
        icon: HeartPulseIcon,
      },
    ],
  },
  {
    title: "Travels",
    items: [{ href: "/travels", label: "Travels", icon: PlaneIcon }],
  },
  {
    title: "Games",
    items: [
      { href: "/games/mosaic", label: "Mosaic", icon: GridIcon },
      { href: "/games/mambo", label: "Mambo", icon: MusicIcon },
      { href: "/games/mastermind", label: "Mastermind", icon: PuzzleIcon },
      { href: "/games/sets", label: "Sets", icon: DiceIcon },
      { href: "/lotto", label: "Lotto", icon: TicketIcon },
    ],
  },
  {
    title: null,
    items: [{ href: "/settings", label: "Settings", icon: SettingsIcon }],
  },
];

/** Every destination, flattened — parents and sub-pages alike. */
export type NavDestination = {
  href: string;
  label: string;
  icon: NavIcon;
  /** Section heading, used as the search result's supporting line. */
  section: string;
  /** Parent page label when this is a sub-page. */
  parent?: string;
};

export const NAV_DESTINATIONS: readonly NavDestination[] = NAV_SECTIONS.flatMap(
  (section) =>
    section.items.flatMap((item): NavDestination[] => [
      {
        href: item.href,
        label: item.label,
        icon: item.icon,
        section: section.title ?? "General",
      },
      ...(item.children ?? []).map((child) => ({
        href: child.href,
        label: child.label,
        icon: child.icon,
        section: section.title ?? "General",
        parent: item.label,
      })),
    ]),
);

/**
 * The nav entry the current URL belongs to.
 *
 * Longest match wins, so `/payslip/settings` resolves to `/payslip` rather
 * than to `/settings`, and a nested route highlights the page it lives under.
 */
export function matchingNavHref(pathname: string): string {
  const sorted = [...NAV_DESTINATIONS].sort(
    (a, b) => b.href.length - a.href.length,
  );
  for (const { href } of sorted) {
    if (pathname === href || pathname.startsWith(`${href}/`)) return href;
  }
  return "";
}

/** The destination a URL resolves to, for titles and breadcrumbs. */
export function activeDestination(pathname: string): NavDestination | null {
  const href = matchingNavHref(pathname);
  return NAV_DESTINATIONS.find((d) => d.href === href) ?? null;
}

/** Case-insensitive substring match over labels, parents and sections. */
export function searchDestinations(query: string): readonly NavDestination[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return NAV_DESTINATIONS.filter((d) =>
    [d.label, d.parent ?? "", d.section].some((s) =>
      s.toLowerCase().includes(q),
    ),
  ).slice(0, 8);
}
