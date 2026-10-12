import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const inputClasses =
  'focus-ring block w-full rounded-md border border-border bg-surface-sunken px-3 h-10 text-sm text-text ' +
  'placeholder:text-text-subtle transition-colors hover:border-border-strong ' +
  'disabled:cursor-not-allowed disabled:opacity-60 read-only:bg-surface ' +
  'aria-[invalid=true]:border-danger';

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, invalid, type = 'text', ...rest },
  ref,
) {
  return (
    <input
      ref={ref}
      type={type}
      className={cn(inputClasses, className)}
      aria-invalid={invalid || rest['aria-invalid'] || undefined}
      {...rest}
    />
  );
});
