import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { ApiError, setup } from '../lib/api';
import { Button, FormField, Input } from '../components/ui';
import { AuthShell, FormAlert } from './Login';

export const MIN_PASSWORD_LENGTH = 6;

export function Setup() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const errors = {
    username: username.trim() ? undefined : 'Username is required',
    password: password.length >= MIN_PASSWORD_LENGTH ? undefined : `Use at least ${MIN_PASSWORD_LENGTH} characters`,
    confirm: confirm === password ? undefined : 'Passwords do not match',
  };
  const show = (key: keyof typeof errors) => (submitted ? errors[key] : undefined);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    setPending(true);
    setError(null);
    try {
      await setup({ username: username.trim(), password });
      navigate('/', { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        navigate('/login', { replace: true });
        return;
      }
      setError(err instanceof ApiError ? (err.errors[0]?.errorMessage ?? err.message) : 'Could not reach Sonarr.');
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell title="Welcome to Sonarr" description="Create the account you will use to sign in.">
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {error && <FormAlert>{error}</FormAlert>}
        <FormField label="Username" required error={show('username')}>
          <Input autoComplete="username" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
        </FormField>
        <FormField label="Password" required error={show('password')} help={`At least ${MIN_PASSWORD_LENGTH} characters.`}>
          <Input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </FormField>
        <FormField label="Confirm password" required error={show('confirm')}>
          <Input type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </FormField>
        <Button type="submit" variant="primary" icon={<ShieldCheck />} loading={pending} className="w-full">
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
