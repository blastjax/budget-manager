"use client";

import { useEffect } from "react";
import { ACTION_BUTTON_CLASSES } from "@/lib/ui";

/**
 * Root error boundary — surfaces recoverable UI when a route segment throws.
 * In development, check the browser console for the full error and `digest`.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("App error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
        Something went wrong
      </h1>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        {process.env.NODE_ENV === "development" && error.message
          ? error.message
          : "An error occurred while rendering this page. Try again, or reload the app."}
      </p>
      {process.env.NODE_ENV === "development" && error.digest ? (
        <p className="font-mono text-xs text-zinc-500">digest: {error.digest}</p>
      ) : null}
      <button
        type="button"
        className={ACTION_BUTTON_CLASSES}
        onClick={() => reset()}
      >
        Try again
      </button>
    </div>
  );
}
