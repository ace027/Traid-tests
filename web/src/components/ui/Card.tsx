import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  /** Buttons rendered in the card header. */
  actions?: ReactNode;
  footer?: ReactNode;
  /** Remove body padding (e.g. for edge-to-edge tables). */
  flush?: boolean;
  headingLevel?: 2 | 3 | 4;
}

export function Card({ title, description, actions, footer, flush, headingLevel = 2, className, children, ...rest }: CardProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section
      className={cn('overflow-hidden rounded-lg border border-border bg-surface-raised shadow-sm', className)}
      {...rest}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title && <Heading className="text-base font-semibold text-text">{title}</Heading>}
            {description && <p className="mt-0.5 text-sm text-text-muted">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={cn(!flush && 'p-5')}>{children}</div>
      {footer && <footer className="flex justify-end gap-2 border-t border-border bg-surface px-5 py-3">{footer}</footer>}
    </section>
  );
}
