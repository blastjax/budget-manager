"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

const LS_SIDEBAR_COLLAPSED = "blastjax:shell:sidebarCollapsed";

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw === "1" || raw === "true") return true;
    if (raw === "0" || raw === "false") return false;
  } catch {
    /* private mode / blocked storage — fall through to the default */
  }
  return fallback;
}

type ShellLayoutValue = {
  /** Desktop (`lg` and up): sidebar shown as an icon rail instead of full width. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** Slide-over navigation (viewports below `lg` only). */
  mobileNavOpen: boolean;
  setMobileNavOpen: Dispatch<SetStateAction<boolean>>;
  closeMobileNav: () => void;
};

const ShellLayoutContext = createContext<ShellLayoutValue | null>(null);

export function ShellLayoutProvider({ children }: { children: ReactNode }) {
  const [hydrated, setHydrated] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);

  // Read persisted state after mount: the server render has no localStorage,
  // so starting from the default and correcting here keeps hydration stable.
  useEffect(() => {
    setSidebarCollapsed(readBool(LS_SIDEBAR_COLLAPSED, false));
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(LS_SIDEBAR_COLLAPSED, sidebarCollapsed ? "1" : "0");
    } catch {
      /* nothing to do — the preference just won't survive a reload */
    }
  }, [hydrated, sidebarCollapsed]);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((v) => !v);
  }, []);

  const closeMobileNav = useCallback(() => {
    setMobileNavOpen(false);
  }, []);

  // Growing past `lg` turns the slide-over into the docked sidebar; leaving it
  // open would strand a backdrop over the page.
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => {
      if (mq.matches) setMobileNavOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Lock the page behind the open slide-over so touch scrolling stays in it.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileNavOpen]);

  const value = useMemo(
    (): ShellLayoutValue => ({
      sidebarCollapsed,
      toggleSidebar,
      mobileNavOpen,
      setMobileNavOpen,
      closeMobileNav,
    }),
    [sidebarCollapsed, toggleSidebar, mobileNavOpen, closeMobileNav],
  );

  return (
    <ShellLayoutContext.Provider value={value}>
      {children}
    </ShellLayoutContext.Provider>
  );
}

export function useShellLayout(): ShellLayoutValue {
  const ctx = useContext(ShellLayoutContext);
  if (!ctx) {
    throw new Error("useShellLayout must be used within ShellLayoutProvider");
  }
  return ctx;
}
