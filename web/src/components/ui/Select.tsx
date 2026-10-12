import { forwardRef, type SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import { inputClasses } from './Input';

export interface SelectOption {
  value: string | number;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /** Convenience for simple option lists; children work too. */
  options?: SelectOption[];
  invalid?: boolean;
}

/** Native <select> styled to match the design system. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, options, invalid, children, ...rest },
  ref,
) {
  return (
    <div className={cn('relative', className)}>
      <select
        ref={ref}
        className={cn(inputClasses, 'appearance-none pr-9 cursor-pointer')}
        aria-invalid={invalid || rest['aria-invalid'] || undefined}
        {...rest}
      >
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-muted"
      />
    </div>
  );
});
