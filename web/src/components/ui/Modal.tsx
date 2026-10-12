import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Visually hide the title (it still labels the dialog). */
  hideTitle?: boolean;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Element to focus on open; defaults to the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Close when the backdrop is clicked (default true). */
  closeOnBackdrop?: boolean;
  /** Hide the X button in the header. */
  hideCloseButton?: boolean;
  /** Align dialog to the top (command palette style). */
  position?: 'center' | 'top';
  className?: string;
}

const sizes = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' } as const;

const FOCUSABLE =
  'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusable(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => !el.hasAttribute('inert') && el.getAttribute('aria-hidden') !== 'true',
  );
}

/**
 * Accessible dialog: rendered in a portal, labelled by its title, traps focus,
 * closes on Escape or backdrop click and returns focus to the element that
 * opened it.
 */
export function Modal({
  open,
  onClose,
  title,
  hideTitle,
  description,
  children,
  footer,
  size = 'md',
  initialFocusRef,
  closeOnBackdrop = true,
  hideCloseButton,
  position = 'center',
  className,
}: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Focus management: move focus in on open, restore on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    if (panel) {
      const target = initialFocusRef?.current ?? focusable(panel)[0] ?? panel;
      target.focus();
    }
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus();
    };
    // initialFocusRef is a ref; reading it once on open is intended.
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab' || !panelRef.current) return;
    const items = focusable(panelRef.current);
    if (items.length === 0) {
      e.preventDefault();
      panelRef.current.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === panelRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className={cn(
        'fixed inset-0 z-50 flex justify-center overflow-y-auto p-4 sm:p-6',
        position === 'top' ? 'items-start pt-[12vh]' : 'items-center',
      )}
      onKeyDown={onKeyDown}
    >
      <div
        aria-hidden="true"
        data-testid="modal-backdrop"
        className="animate-fade-in fixed inset-0 bg-overlay backdrop-blur-sm"
        onClick={() => closeOnBackdrop && onCloseRef.current()}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={cn(
          'animate-pop-in relative flex w-full flex-col rounded-xl border border-border bg-surface-raised shadow-lg outline-none',
          sizes[size],
          className,
        )}
      >
        <div className={cn('flex items-start justify-between gap-4', hideTitle ? 'sr-only' : 'px-5 pt-5 pb-3')}>
          <div className="min-w-0">
            <h2 id={titleId} className="text-lg font-semibold text-text">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-text-muted">
                {description}
              </p>
            )}
          </div>
          {!hideCloseButton && !hideTitle && (
            <button
              type="button"
              onClick={() => onCloseRef.current()}
              aria-label="Close"
              className="focus-ring -mt-1 -mr-1 rounded-md p-1.5 text-text-muted hover:bg-surface-hover hover:text-text"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>
        {children !== undefined && <div className={cn(!hideTitle && 'px-5 pb-5')}>{children}</div>}
        {footer && (
          <div className="flex flex-wrap justify-end gap-2 rounded-b-xl border-t border-border bg-surface px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
