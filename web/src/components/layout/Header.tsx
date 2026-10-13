import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, Laptop, LogOut, Menu, Moon, Search, Sun } from 'lucide-react';
import { cn } from '../../lib/cn';
import { useTheme, type ThemePreference } from '../../lib/theme';
import { useConnectionStatus, type ConnectionStatus } from '../../lib/events';
import { loadInitialize, logout, redirectToLogin, type InitializeConfig } from '../../lib/api';
import { SIDEBAR_ID } from './Sidebar';

export interface HeaderProps {
  mobileNavOpen: boolean;
  onOpenMobileNav: () => void;
  onOpenPalette: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

const themeOptions: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'system', label: 'System', icon: Laptop },
];

function ThemeMenu() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const items = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]');
    const current = Array.from(items ?? []).find((i) => i.getAttribute('aria-checked') === 'true');
    (current ?? items?.[0])?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [open]);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? []);
    const idx = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      items[(idx + 1) % items.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      items[(idx - 1 + items.length) % items.length]?.focus();
    } else if (e.key === 'Home') {
      e.preventDefault();
      items[0]?.focus();
    } else if (e.key === 'End') {
      e.preventDefault();
      items[items.length - 1]?.focus();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const CurrentIcon = theme === 'system' ? Laptop : resolvedTheme === 'light' ? Sun : Moon;

  return (
    <div ref={wrapperRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-label={`Theme: ${themeOptions.find((o) => o.value === theme)?.label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className="focus-ring flex size-9 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text"
      >
        <CurrentIcon aria-hidden="true" className="size-5" />
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Theme"
          onKeyDown={onMenuKeyDown}
          className="animate-pop-in absolute right-0 z-50 mt-2 w-40 rounded-lg border border-border bg-surface-raised p-1 shadow-lg"
        >
          {themeOptions.map(({ value, label, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked={theme === value}
              tabIndex={-1}
              onClick={() => {
                setTheme(value);
                close();
              }}
              className="focus-ring flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-sm text-text hover:bg-surface-hover focus:bg-surface-hover"
            >
              <Icon aria-hidden="true" className="size-4 text-text-muted" />
              <span className="flex-1">{label}</span>
              {theme === value && <Check aria-hidden="true" className="size-4 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const statusStyles: Record<ConnectionStatus, { dot: string; label: string }> = {
  connected: { dot: 'bg-success', label: 'Live' },
  connecting: { dot: 'bg-warning animate-pulse', label: 'Connecting' },
  disconnected: { dot: 'bg-danger', label: 'Offline' },
};

function ConnectionIndicator() {
  const status = useConnectionStatus();
  const { dot, label } = statusStyles[status];
  return (
    <div
      role="status"
      title={`Live updates: ${status}`}
      data-status={status}
      className="flex items-center gap-2 rounded-full border border-border px-2.5 py-1 text-xs text-text-muted"
    >
      <span aria-hidden="true" className={cn('size-2 rounded-full', dot)} />
      <span className="sr-only">Live updates: </span>
      <span className="max-sm:sr-only">{label}</span>
    </div>
  );
}

/** Signs out of a forms-auth session; hidden for external (proxy) authentication. */
function LogoutButton() {
  const [init, setInit] = useState<InitializeConfig | null>(null);
  useEffect(() => {
    let active = true;
    loadInitialize().then(
      (i) => active && setInit(i),
      () => {},
    );
    return () => {
      active = false;
    };
  }, []);
  if (init?.authMethod !== 'forms') return null;
  const onLogout = async () => {
    try {
      await logout();
    } finally {
      redirectToLogin(init.urlBase);
    }
  };
  return (
    <button
      type="button"
      onClick={() => void onLogout()}
      aria-label="Log out"
      title="Log out"
      className="focus-ring flex size-9 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text"
    >
      <LogOut aria-hidden="true" className="size-5" />
    </button>
  );
}

export function Header({ mobileNavOpen, onOpenMobileNav, onOpenPalette }: HeaderProps) {
  return (
    <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-surface/80 px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        onClick={onOpenMobileNav}
        aria-label="Open navigation"
        aria-expanded={mobileNavOpen}
        aria-controls={SIDEBAR_ID}
        className="focus-ring -ml-1 flex size-9 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text md:hidden"
      >
        <Menu aria-hidden="true" className="size-5" />
      </button>

      <button
        type="button"
        onClick={onOpenPalette}
        aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}
        className="focus-ring flex h-9 w-full max-w-md min-w-0 items-center gap-2.5 rounded-md border border-border bg-surface-sunken px-3 text-sm text-text-subtle transition-colors hover:border-border-strong hover:text-text-muted"
      >
        <Search aria-hidden="true" className="size-4 shrink-0" />
        <span className="flex-1 truncate text-left">Search</span>
        <kbd aria-hidden="true" className="hidden rounded border border-border bg-surface px-1.5 py-0.5 font-sans text-[11px] font-medium text-text-muted sm:inline">
          {isMac ? '⌘' : 'Ctrl'} K
        </kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        <ConnectionIndicator />
        <ThemeMenu />
        <LogoutButton />
      </div>
    </header>
  );
}
