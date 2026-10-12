import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CircleCheck, CircleX, Info, X } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ToastKind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: ToastKind;
  message: ReactNode;
}

export interface ToastApi {
  success: (message: ReactNode) => void;
  error: (message: ReactNode) => void;
  info: (message: ReactNode) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export const TOAST_DURATION_MS = 5000;

const styles: Record<ToastKind, { icon: typeof Info; className: string; label: string }> = {
  success: { icon: CircleCheck, className: 'text-success', label: 'Success' },
  error: { icon: CircleX, className: 'text-danger', label: 'Error' },
  info: { icon: Info, className: 'text-info', label: 'Info' },
};

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    const t = setTimeout(() => onDismiss(toast.id), TOAST_DURATION_MS);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);
  const { icon: Icon, className, label } = styles[toast.kind];
  return (
    <li
      className="animate-pop-in pointer-events-auto flex w-full items-start gap-3 rounded-lg border border-border bg-surface-raised p-3.5 shadow-lg"
      data-kind={toast.kind}
    >
      <Icon aria-hidden="true" className={cn('mt-0.5 size-5 shrink-0', className)} />
      <p className="min-w-0 flex-1 text-sm text-text">
        <span className="sr-only">{label}: </span>
        {toast.message}
      </p>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label="Dismiss notification"
        className="focus-ring -m-1 rounded-md p-1 text-text-muted hover:bg-surface-hover hover:text-text"
      >
        <X aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
}

/** Provides useToast() and renders the polite live region for notifications. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => {
    const push = (kind: ToastKind) => (message: ReactNode) => {
      const id = nextId.current++;
      setToasts((list) => [...list.slice(-4), { id, kind, message }]);
    };
    return { success: push('success'), error: push('error'), info: push('info') };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        role="region"
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex justify-center p-4 sm:inset-x-auto sm:right-0 sm:justify-end"
      >
        <ol aria-live="polite" aria-relevant="additions text" className="flex w-full max-w-sm flex-col gap-2">
          {toasts.map((t) => (
            <ToastView key={t.id} toast={t} onDismiss={dismiss} />
          ))}
        </ol>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
