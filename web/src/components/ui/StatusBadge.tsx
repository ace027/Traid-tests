import type { ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, CircleSlash, Info, Loader2, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { Badge, type BadgeVariant } from './Badge';

export type StatusKind = 'ok' | 'info' | 'warning' | 'error' | 'running' | 'muted';

export interface StatusBadgeProps {
  status: StatusKind;
  /** Visible text; status is never conveyed by colour alone. */
  label: ReactNode;
  /** Replaces the default icon for the status. */
  icon?: ReactNode;
  className?: string;
}

const config: Record<StatusKind, { variant: BadgeVariant; icon: ReactNode }> = {
  ok: { variant: 'success', icon: <CheckCircle2 /> },
  info: { variant: 'info', icon: <Info /> },
  warning: { variant: 'warning', icon: <AlertTriangle /> },
  error: { variant: 'danger', icon: <XCircle /> },
  running: { variant: 'accent', icon: <Loader2 className="animate-spin motion-reduce:animate-none" /> },
  muted: { variant: 'neutral', icon: <CircleSlash /> },
};

export function StatusBadge({ status, label, icon, className }: StatusBadgeProps) {
  const c = config[status];
  return (
    <Badge variant={c.variant} className={cn(className)} data-status={status}>
      <span aria-hidden="true" className="inline-flex [&_svg]:size-3.5">
        {icon ?? c.icon}
      </span>
      {label}
    </Badge>
  );
}
