import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange' | 'value' | 'role' | 'aria-checked'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}

/** Accessible on/off toggle (button with role=switch). Label it via FormField, aria-label or aria-labelledby. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, className, disabled, onClick, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onCheckedChange(!checked);
      }}
      className={cn(
        'focus-ring relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-accent bg-accent' : 'border-control-border bg-surface-sunken',
        className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none inline-block size-4.5 rounded-full shadow-sm transition-transform duration-150',
          checked ? 'translate-x-5.5 bg-accent-foreground' : 'translate-x-0.5 bg-text-muted',
        )}
      />
    </button>
  );
});
