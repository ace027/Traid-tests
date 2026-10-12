import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { PanelLeft, PanelLeftClose, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import { isLeafActive, isSectionActive, navigation } from './navigation';

export const SIDEBAR_ID = 'app-sidebar';

export interface SidebarProps {
  /** Desktop (>= md) icon-only mode. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Mobile (< md) off-canvas drawer state. */
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

function Logo({ collapsed }: { collapsed: boolean }) {
  return (
    <Link
      to="/"
      aria-label="Sonarr home"
      className="focus-ring flex items-center gap-2.5 rounded-md text-text"
    >
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-info text-sm font-bold text-accent-foreground shadow-md"
      >
        S
      </span>
      <span className={cn('text-lg font-semibold tracking-tight', collapsed && 'md:sr-only')}>Sonarr</span>
    </Link>
  );
}

export function Sidebar({ collapsed, onToggleCollapsed, mobileOpen, onCloseMobile }: SidebarProps) {
  const { pathname } = useLocation();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef(onCloseMobile);
  closeRef.current = onCloseMobile;

  // Close the drawer whenever the route changes.
  useEffect(() => {
    closeRef.current();
  }, [pathname]);

  // Escape closes the drawer; focus moves into it when it opens.
  useEffect(() => {
    if (!mobileOpen) return;
    panelRef.current?.querySelector<HTMLElement>('a[href], button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  return (
    <>
      {mobileOpen && (
        <div
          aria-hidden="true"
          data-testid="sidebar-overlay"
          className="animate-fade-in fixed inset-0 z-30 bg-overlay backdrop-blur-sm md:hidden"
          onClick={onCloseMobile}
        />
      )}
      <nav
        ref={panelRef}
        id={SIDEBAR_ID}
        aria-label="Main"
        data-collapsed={collapsed || undefined}
        data-mobile-open={mobileOpen || undefined}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-border bg-surface-raised',
          'transition-[transform,width] duration-200 ease-out',
          'md:sticky md:top-0 md:h-dvh md:translate-x-0 md:visible',
          mobileOpen ? 'translate-x-0 shadow-lg' : 'max-md:invisible -translate-x-full',
          collapsed ? 'md:w-[4.5rem]' : 'md:w-64',
        )}
      >
        <div className={cn('flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border px-4', collapsed && 'md:justify-center md:px-0')}>
          <Logo collapsed={collapsed} />
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation"
            className="focus-ring rounded-md p-2 text-text-muted hover:bg-surface-hover hover:text-text md:hidden"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-3 py-4">
          <ul className="flex flex-col gap-1">
            {navigation.map((section) => {
              const active = isSectionActive(section, pathname);
              const Icon = section.icon;
              return (
                <li key={section.label}>
                  <Link
                    to={section.path}
                    title={collapsed ? section.label : undefined}
                    aria-current={active && pathname === section.path ? 'page' : undefined}
                    className={cn(
                      'focus-ring group relative flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors',
                      collapsed && 'md:justify-center md:px-0',
                      active ? 'bg-accent-soft text-text' : 'text-text-muted hover:bg-surface-hover hover:text-text',
                    )}
                  >
                    {active && (
                      <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-accent" />
                    )}
                    <Icon aria-hidden="true" className={cn('size-5 shrink-0', active ? 'text-accent' : 'group-hover:text-text')} />
                    <span className={cn('truncate', collapsed && 'md:sr-only')}>{section.label}</span>
                  </Link>
                  {active && section.children && (
                    <ul
                      aria-label={`${section.label} pages`}
                      className={cn('mt-1 mb-2 ml-5 flex flex-col gap-0.5 border-l border-border pl-3', collapsed && 'md:hidden')}
                    >
                      {section.children.map((leaf) => {
                        const leafActive = isLeafActive(leaf, pathname);
                        return (
                          <li key={leaf.path}>
                            <Link
                              to={leaf.path}
                              aria-current={leafActive ? 'page' : undefined}
                              className={cn(
                                'focus-ring flex h-8 items-center rounded-md px-2.5 text-sm transition-colors',
                                leafActive
                                  ? 'font-medium text-accent'
                                  : 'text-text-muted hover:bg-surface-hover hover:text-text',
                              )}
                            >
                              {leaf.label}
                            </Link>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="hidden shrink-0 border-t border-border p-3 md:block">
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
            aria-controls={SIDEBAR_ID}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={cn(
              'focus-ring flex h-9 w-full items-center gap-3 rounded-md px-3 text-sm text-text-muted hover:bg-surface-hover hover:text-text',
              collapsed && 'justify-center px-0',
            )}
          >
            {collapsed ? <PanelLeft aria-hidden="true" className="size-5" /> : <PanelLeftClose aria-hidden="true" className="size-5" />}
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </nav>
    </>
  );
}
