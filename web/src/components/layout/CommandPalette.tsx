import { useContext, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { QueryClientContext } from '@tanstack/react-query';
import { CornerDownLeft, Search, Tv } from 'lucide-react';
import type { Series } from '@sonarr/shared';
import { Modal } from '../ui/Modal';
import { cn } from '../../lib/cn';
import { queryKeys } from '../../lib/api';
import { flattenNavigation, type NavEntry } from './navigation';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Extra entries (e.g. series) appended after navigation. */
  extraEntries?: NavEntry[];
}

function matches(entry: NavEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${entry.section} ${entry.label} ${entry.path}`.toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

/**
 * Series already in the query cache, as palette entries. Read once when the palette
 * opens; never fetches, and works without a QueryClientProvider (returns []).
 */
function useCachedSeriesEntries(): NavEntry[] {
  const client = useContext(QueryClientContext);
  return useMemo(() => {
    const list = client?.getQueryData<Series[]>(queryKeys.series) ?? [];
    return [...list]
      .sort((a, b) => (a.sortTitle || a.title).localeCompare(b.sortTitle || b.title))
      .map((s) => ({ label: s.title, section: 'Series', path: `/series/${s.titleSlug}`, icon: Tv }));
  }, [client]);
}

function PaletteBody({ onClose, extraEntries }: Omit<CommandPaletteProps, 'open'>) {
  const navigate = useNavigate();
  const seriesEntries = useCachedSeriesEntries();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const all = useMemo(
    () => [...flattenNavigation(), ...seriesEntries, ...(extraEntries ?? [])],
    [seriesEntries, extraEntries],
  );
  const results = useMemo(() => all.filter((e) => matches(e, query)), [all, query]);
  const activeIndex = Math.min(active, Math.max(results.length - 1, 0));
  const optionId = (i: number) => `${listId}-opt-${i}`;

  const go = (entry: NavEntry | undefined) => {
    if (!entry) return;
    onClose();
    navigate(entry.path);
  };

  const move = (delta: number) => {
    if (results.length === 0) return;
    const next = (activeIndex + delta + results.length) % results.length;
    setActive(next);
    document.getElementById(optionId(next))?.scrollIntoView?.({ block: 'nearest' });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(results[activeIndex]);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4">
        <Search aria-hidden="true" className="size-5 shrink-0 text-text-muted" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label="Search pages"
          aria-expanded={results.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={results.length > 0 ? optionId(activeIndex) : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder="Jump to a page..."
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className="h-14 w-full bg-transparent text-base text-text outline-none placeholder:text-text-subtle"
        />
      </div>
      <ul ref={listRef} id={listId} role="listbox" aria-label="Pages" className="max-h-80 overflow-y-auto p-2">
        {results.map((entry, i) => {
          const Icon = entry.icon;
          const selected = i === activeIndex;
          return (
            <li
              key={entry.path}
              id={optionId(i)}
              role="option"
              aria-selected={selected}
              onMouseMove={() => setActive(i)}
              onClick={() => go(entry)}
              className={cn(
                'flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 text-sm',
                selected ? 'bg-accent-soft text-text' : 'text-text-muted',
              )}
            >
              <Icon aria-hidden="true" className={cn('size-4 shrink-0', selected && 'text-accent')} />
              <span className="flex-1 truncate">
                {entry.section !== entry.label && <span className="text-text-subtle">{entry.section} / </span>}
                <span className="font-medium text-text">{entry.label}</span>
              </span>
              {selected && <CornerDownLeft aria-hidden="true" className="size-4 text-text-subtle" />}
            </li>
          );
        })}
      </ul>
      {results.length === 0 && (
        <p role="status" className="px-4 pt-2 pb-6 text-center text-sm text-text-muted">
          No pages match "{query}"
        </p>
      )}
      <p className="hidden border-t border-border px-4 py-2 text-xs text-text-subtle sm:block">
        Arrow keys to move, Enter to open, Esc to close
      </p>
    </div>
  );
}

/** Ctrl/Cmd+K palette that jumps to any page or any series in the library. */
export function CommandPalette({ open, onClose, extraEntries }: CommandPaletteProps) {
  return (
    <Modal open={open} onClose={onClose} title="Go to page" hideTitle size="lg" position="top" className="overflow-hidden">
      {open && <PaletteBody onClose={onClose} extraEntries={extraEntries} />}
    </Modal>
  );
}
