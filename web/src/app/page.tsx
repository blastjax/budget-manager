import Link from "next/link";

const HOME_TILES = [
  {
    href: "/calendar",
    title: "Finances",
    description: "Payslips, salary stats, installments & house payments",
    dotClassName: "bg-indigo-500",
  },
  {
    href: "/blood-pressure",
    title: "Health",
    description: "Blood-pressure readings & charts",
    dotClassName: "bg-rose-500",
  },
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex min-h-full w-full max-w-xl flex-col justify-center gap-1 px-4 py-10 sm:px-6">
      {HOME_TILES.map(({ href, title, description, dotClassName }) => (
        <Link
          key={href}
          href={href}
          className="flex items-center gap-3 rounded-md border border-transparent px-4 py-4 transition-colors duration-150 hover:border-zinc-200 hover:bg-zinc-50 dark:hover:border-zinc-800 dark:hover:bg-zinc-900/60"
        >
          <span
            className={`h-2 w-2 shrink-0 rounded-full ${dotClassName}`}
            aria-hidden
          />
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              {title}
            </span>
            <span className="truncate text-xs text-zinc-500 dark:text-zinc-500">
              {description}
            </span>
          </span>
        </Link>
      ))}
    </main>
  );
}
