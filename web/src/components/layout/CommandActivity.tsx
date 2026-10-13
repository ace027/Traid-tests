import { useContext, useEffect, useId, useRef, useState } from 'react';
import { QueryClientContext, useQuery } from '@tanstack/react-query';
import { Activity, Loader2 } from 'lucide-react';
import type { Command } from '@sonarr/shared';
import { api, queryKeys } from '../../lib/api';
import { StatusBadge, useToast, type StatusKind } from '../ui';

export const humanize = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');

const active = (c: Command) => c.status === 'queued' || c.status === 'started';
const finished = (c: Command) => c.status === 'completed' || c.status === 'failed' || c.status === 'aborted';

const badge: Record<Command['status'], { kind: StatusKind; label: string }> = {
  queued: { kind: 'muted', label: 'Queued' },
  started: { kind: 'running', label: 'Running' },
  completed: { kind: 'ok', label: 'Completed' },
  failed: { kind: 'error', label: 'Failed' },
  aborted: { kind: 'warning', label: 'Aborted' },
};

/** Renders nothing without a QueryClient (layout tests render the header bare). */
export function CommandActivity() {
  const client = useContext(QueryClientContext);
  return client ? <CommandActivityInner /> : null;
}

function CommandActivityInner() {
  const toast = useToast();
  const popoverId = useId();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const seen = useRef<Map<number, Command['status']> | null>(null);

  const commands = useQuery({ queryKey: queryKeys.commands, queryFn: () => api.get<Command[]>('command') });
  const data = commands.data;

  // Announce each command transition into a final state exactly once.
  useEffect(() => {
    if (!data) return;
    const previous = seen.current;
    const next = new Map<number, Command['status']>();
    for (const c of data) next.set(c.id, c.status);
    seen.current = next;
    if (!previous) return; // first load: nothing to announce
    for (const c of data) {
      if (!finished(c)) continue;
      const before = previous.get(c.id);
      if (before === c.status) continue;
      if (before !== undefined && !(before === 'queued' || before === 'started')) continue;
      const name = humanize(c.name);
      if (c.status === 'completed') setAnnouncement(`${name} completed`);
      else if (c.status === 'failed') {
        const text = `${name} failed: ${c.message ?? 'Unknown error'}`;
        setAnnouncement(text);
        toast.error(text);
      } else setAnnouncement(`${name} aborted`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const running = (data ?? []).filter(active);
  const recent = (data ?? [])
    .filter(finished)
    .sort((a, b) => (b.ended ?? b.queued).localeCompare(a.ended ?? a.queued))
    .slice(0, 5);

  return (
    <div ref={wrapperRef} className="relative">
      <div aria-live="polite" role="status" className="sr-only" data-testid="command-announcer">
        {announcement}
      </div>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        aria-label={
          running.length > 0
            ? `${running.length} running ${running.length === 1 ? 'command' : 'commands'}`
            : 'No running commands'
        }
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex h-9 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-text-muted hover:bg-surface-hover hover:text-text"
      >
        {running.length > 0 ? (
          <>
            <Loader2 aria-hidden="true" className="size-4 animate-spin motion-reduce:animate-none" />
            <span aria-hidden="true">{running.length}</span>
          </>
        ) : (
          <Activity aria-hidden="true" className="size-4" />
        )}
      </button>
      {open && (
        <div
          id={popoverId}
          role="region"
          aria-label="Command activity"
          className="animate-pop-in absolute right-0 z-50 mt-2 max-h-96 w-80 max-w-[90vw] overflow-y-auto rounded-lg border border-border bg-surface-raised p-3 shadow-lg"
        >
          <h2 className="mb-2 text-xs font-semibold tracking-wide text-text-muted uppercase">Active</h2>
          {running.length === 0 && <p className="text-sm text-text-muted">No active commands</p>}
          <ul className="flex flex-col gap-2">
            {running.map((c) => (
              <li key={c.id} className="flex flex-col gap-0.5 text-sm">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium text-text">{humanize(c.name)}</span>
                  <StatusBadge status={badge[c.status].kind} label={badge[c.status].label} />
                </span>
                {c.message && <span className="text-xs text-text-muted">{c.message}</span>}
              </li>
            ))}
          </ul>
          {recent.length > 0 && (
            <>
              <h2 className="mt-3 mb-2 text-xs font-semibold tracking-wide text-text-muted uppercase">Recently completed</h2>
              <ul className="flex flex-col gap-2">
                {recent.map((c) => (
                  <li key={c.id} className="flex flex-col gap-0.5 text-sm">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-text">{humanize(c.name)}</span>
                      <StatusBadge status={badge[c.status].kind} label={badge[c.status].label} />
                    </span>
                    {c.message && <span className="text-xs text-text-muted">{c.message}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
