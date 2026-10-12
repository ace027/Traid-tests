import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** Primary page actions, right-aligned. */
  actions?: ReactNode;
  /** Secondary row for filters, view toggles and the like. */
  toolbar?: ReactNode;
  className?: string;
}

export function PageHeader({ title, description, actions, toolbar, className }: PageHeaderProps) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4', className)}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-text">{title}</h1>
          {description && <p className="mt-1 text-sm text-text-muted">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {toolbar && (
        <div role="toolbar" aria-label="Page tools" className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-raised p-2">
          {toolbar}
        </div>
      )}
    </div>
  );
}
