import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
  /** Icon rendered before the label. */
  icon?: ReactNode;
  /** Icon rendered after the label. */
  iconRight?: ReactNode;
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-foreground hover:bg-accent-hover shadow-sm',
  secondary: 'bg-surface-raised text-text border border-border hover:bg-surface-hover hover:border-border-strong shadow-sm',
  ghost: 'bg-transparent text-text-muted hover:bg-surface-hover hover:text-text',
  danger: 'bg-danger text-white hover:bg-danger-hover shadow-sm',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5 [&_svg]:size-4 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:min-w-11',
  md: 'h-10 px-4 text-sm gap-2 [&_svg]:size-4 [@media(pointer:coarse)]:h-11',
};

export const buttonClasses = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className?: string) =>
  cn(
    'focus-ring inline-flex shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap',
    'transition-colors duration-150 select-none',
    'disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    sizes[size],
    className,
  );

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading = false, icon, iconRight, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : icon}
      {children}
      {iconRight}
    </button>
  );
});
