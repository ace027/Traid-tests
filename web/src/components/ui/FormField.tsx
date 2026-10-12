import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

type ControlProps = {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  'aria-required'?: boolean;
};

export interface FormFieldProps {
  label: ReactNode;
  /** A single form control; it receives id, aria-describedby and aria-invalid. */
  children: ReactElement<ControlProps>;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Override the generated control id. */
  id?: string;
  /** Put label and control on one row (useful for switches). */
  inline?: boolean;
  className?: string;
}

export function FormField({ label, children, help, error, required, id, inline, className }: FormFieldProps) {
  const autoId = useId();
  const controlId = id ?? children.props.id ?? `field-${autoId}`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy =
    [children.props['aria-describedby'], helpId, errorId].filter(Boolean).join(' ') || undefined;

  const control = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        'aria-describedby': describedBy,
        'aria-invalid': error ? true : children.props['aria-invalid'],
        'aria-required': required || children.props['aria-required'],
      })
    : children;

  return (
    <div className={cn('flex gap-1.5', inline ? 'flex-row items-center justify-between gap-4' : 'flex-col', className)}>
      <div className="flex flex-col gap-0.5">
        <label htmlFor={controlId} className="text-sm font-medium text-text">
          {label}
          {required && (
            <span aria-hidden="true" className="ml-0.5 text-danger">
              *
            </span>
          )}
        </label>
        {inline && help && (
          <p id={helpId} className="text-xs text-text-muted">
            {help}
          </p>
        )}
      </div>
      {control}
      {!inline && help && (
        <p id={helpId} className="text-xs text-text-muted">
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
