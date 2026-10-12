import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/cn';

export type SortDirection = 'ascending' | 'descending';

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /** Visible or screen-reader caption; strongly recommended. */
  caption?: ReactNode;
  captionHidden?: boolean;
}

export function Table({ caption, captionHidden, className, children, ...rest }: TableProps) {
  return (
    <div className="w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-left text-sm', className)} {...rest}>
        {caption && (
          <caption className={cn(captionHidden ? 'sr-only' : 'px-4 py-2 text-left text-sm text-text-muted')}>
            {caption}
          </caption>
        )}
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn('border-b border-border bg-surface', className)} {...rest} />;
}

export function TBody({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn('divide-y divide-border', className)} {...rest} />;
}

export function Tr({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn('transition-colors hover:bg-surface-hover/60', className)} {...rest} />;
}

export interface ThProps extends ThHTMLAttributes<HTMLTableCellElement> {
  /** Makes the header a sort button. Current direction or null when unsorted. */
  sortable?: boolean;
  sortDirection?: SortDirection | null;
  onSort?: () => void;
}

export function Th({ sortable, sortDirection = null, onSort, className, children, ...rest }: ThProps) {
  const base = 'px-4 py-2.5 text-xs font-semibold tracking-wide text-text-muted uppercase';
  if (!sortable) {
    return (
      <th scope="col" className={cn(base, className)} {...rest}>
        {children}
      </th>
    );
  }
  const Icon = sortDirection === 'ascending' ? ArrowUp : sortDirection === 'descending' ? ArrowDown : ChevronsUpDown;
  return (
    <th scope="col" aria-sort={sortDirection ?? 'none'} className={cn(base, 'p-0', className)} {...rest}>
      <button
        type="button"
        onClick={onSort}
        className="focus-ring inline-flex w-full items-center gap-1.5 px-4 py-2.5 text-left uppercase hover:text-text"
      >
        {children}
        <Icon aria-hidden="true" className={cn('size-3.5', !sortDirection && 'opacity-50')} />
      </button>
    </th>
  );
}

export function Td({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('px-4 py-3 align-middle text-text', className)} {...rest} />;
}
