import { LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface SpinnerProps {
  /** Accessible label announced by screen readers. */
  label?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizes = { sm: 'size-4', md: 'size-5', lg: 'size-8' } as const;

export function Spinner({ label = 'Loading', size = 'md', className }: SpinnerProps) {
  return (
    <span role="status" className={cn('inline-flex items-center text-accent', className)}>
      <LoaderCircle aria-hidden="true" className={cn('animate-spin', sizes[size])} />
      <span className="sr-only">{label}</span>
    </span>
  );
}
