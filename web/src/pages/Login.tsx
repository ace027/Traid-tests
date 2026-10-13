import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, LogIn, Tv } from 'lucide-react';
import { ApiError, login } from '../lib/api';
import { Button, FormField, Input, Switch } from '../components/ui';

export interface AuthShellProps {
  title: string;
  description?: ReactNode;
  children: ReactNode;
}

/** Centered card used by the login and first-run setup pages (rendered outside AppLayout). */
export function AuthShell({ title, description, children }: AuthShellProps) {
  useEffect(() => {
    document.title = `${title} - Sonarr`;
  }, [title]);
  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface px-4 py-12 text-text">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span aria-hidden="true" className="flex size-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Tv className="size-6" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-text-muted">{description}</p>}
        </div>
        <div className="rounded-xl border border-border bg-surface-raised p-6 shadow-lg">{children}</div>
      </div>
    </main>
  );
}

export function FormAlert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-text">
      <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-danger" />
      <span>{children}</span>
    </div>
  );
}

function loginError(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return 'Incorrect username or password.';
    if (error.status === 429) return 'Too many failed attempts. Wait a few minutes and try again.';
    return error.message;
  }
  return 'Could not reach Sonarr. Check your connection and try again.';
}

export function Login() {
  const navigate = useNavigate();
  const rememberId = useId();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError('Enter your username and password.');
      return;
    }
    setPending(true);
    setError(null);
    try {
      await login({ username, password, rememberMe });
      navigate('/', { replace: true });
    } catch (err) {
      setError(loginError(err));
      setPassword('');
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell title="Sign in to Sonarr">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <FormAlert>{error}</FormAlert>}
        <FormField label="Username" required>
          <Input autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        </FormField>
        <FormField label="Password" required>
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <div className="flex items-center justify-between gap-4">
          <label htmlFor={rememberId} className="text-sm text-text">
            Remember me
          </label>
          <Switch id={rememberId} checked={rememberMe} onCheckedChange={setRememberMe} />
        </div>
        <Button type="submit" variant="primary" icon={<LogIn />} loading={pending} className="w-full">
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
