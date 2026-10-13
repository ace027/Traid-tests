import { useState, type FormEvent } from 'react';
import { Copy, RefreshCw, Save } from 'lucide-react';
import type { HostConfig } from '@sonarr/shared';
import { ApiError } from '../../lib/api';
import { Button, Card, ConfirmDialog, FormField, Input, PageHeader, Select, Spinner, useToast } from '../../components/ui';
import { errorMessage, useHostConfig, useResetApiKey, useUpdateHostConfig } from './hooks';

const LOG_LEVELS = [
  { value: 'trace', label: 'Trace' },
  { value: 'debug', label: 'Debug' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warn' },
  { value: 'error', label: 'Error' },
];

const AUTH_METHODS = [
  { value: 'forms', label: 'Forms (login page)' },
  { value: 'external', label: 'External (reverse proxy)' },
];

const AUTH_REQUIRED = [
  { value: 'enabled', label: 'Enabled' },
  { value: 'disabledForLocalAddresses', label: 'Disabled for local addresses' },
];

const MIN_PASSWORD_LENGTH = 6;
const URL_BASE_CHARS = /^[A-Za-z0-9._~/-]*$/;

interface Draft {
  bindAddress: string;
  port: string;
  urlBase: string;
  instanceName: string;
  logLevel: HostConfig['logLevel'];
  authenticationMethod: HostConfig['authenticationMethod'];
  authenticationRequired: HostConfig['authenticationRequired'];
  username: string;
  /** Blank keeps the current password. */
  password: string;
}

const toDraft = (c: HostConfig): Draft => ({
  bindAddress: c.bindAddress,
  port: String(c.port),
  urlBase: c.urlBase,
  instanceName: c.instanceName,
  logLevel: c.logLevel,
  authenticationMethod: c.authenticationMethod,
  authenticationRequired: c.authenticationRequired,
  username: c.username,
  password: '',
});

function GeneralForm({ config }: { config: HostConfig }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(config));
  const [confirmReset, setConfirmReset] = useState(false);
  const save = useUpdateHostConfig({
    onSuccess: () => {
      setDraft((d) => ({ ...d, password: '' }));
      toast.success('General settings saved');
    },
  });
  const reset = useResetApiKey({
    onSuccess: () => {
      setConfirmReset(false);
      // The UI reads the API key from the cached initialize.json; a reload fetches the new one.
      window.location.reload();
    },
  });

  const saved = toDraft(config);
  const dirty = (Object.keys(saved) as (keyof Draft)[]).some((k) => saved[k] !== draft[k]);

  const port = Number(draft.port);
  const clientErrors = {
    bindAddress: draft.bindAddress.trim() ? undefined : 'Bind address is required',
    port: Number.isInteger(port) && port >= 1 && port <= 65535 ? undefined : 'Port must be between 1 and 65535',
    urlBase: URL_BASE_CHARS.test(draft.urlBase.trim()) ? undefined : 'URL base may only contain letters, digits and . _ ~ / -',
    instanceName: draft.instanceName.trim() ? undefined : 'Instance name is required',
    username: draft.authenticationMethod === 'forms' && !draft.username.trim() ? 'Username is required' : undefined,
    password:
      draft.password && draft.password.length < MIN_PASSWORD_LENGTH
        ? `Password must be at least ${MIN_PASSWORD_LENGTH} characters`
        : undefined,
  };
  const hasClientErrors = Object.values(clientErrors).some(Boolean);
  const serverError = save.error instanceof ApiError ? save.error : null;
  const field = (key: keyof typeof clientErrors) => clientErrors[key] ?? serverError?.fieldError(key);
  const otherError =
    save.error && !(serverError && serverError.errors.length > 0) ? errorMessage(save.error) : undefined;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!dirty || hasClientErrors) return;
    save.mutate({
      bindAddress: draft.bindAddress.trim(),
      port,
      urlBase: draft.urlBase,
      instanceName: draft.instanceName.trim(),
      logLevel: draft.logLevel,
      authenticationMethod: draft.authenticationMethod,
      authenticationRequired: draft.authenticationRequired,
      username: draft.username.trim(),
      ...(draft.password ? { password: draft.password } : {}),
    });
  };

  const copyKey = async () => {
    try {
      await navigator.clipboard.writeText(config.apiKey);
      toast.success('API key copied to clipboard');
    } catch {
      toast.error('Could not copy the API key');
    }
  };

  return (
    <>
      <form onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
        <Card title="Host" description="Changes to the bind address, port and URL base need a restart.">
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Bind address" required error={field('bindAddress')} help="Use * or 0.0.0.0 for all interfaces.">
              <Input value={draft.bindAddress} onChange={(e) => set('bindAddress', e.target.value)} />
            </FormField>
            <FormField label="Port number" required error={field('port')}>
              <Input type="number" min={1} max={65535} value={draft.port} onChange={(e) => set('port', e.target.value)} />
            </FormField>
            <FormField label="URL base" error={field('urlBase')} help="For reverse proxy support, e.g. /sonarr.">
              <Input value={draft.urlBase} onChange={(e) => set('urlBase', e.target.value)} />
            </FormField>
            <FormField label="Instance name" required error={field('instanceName')}>
              <Input value={draft.instanceName} onChange={(e) => set('instanceName', e.target.value)} />
            </FormField>
          </div>
        </Card>

        <Card title="Security" description="How people sign in, and the API key other apps use to connect.">
          <div className="mb-4 grid gap-4 sm:grid-cols-2">
            <FormField
              label="Authentication"
              help={
                draft.authenticationMethod === 'external'
                  ? 'Only choose External when a reverse proxy already authenticates every request.'
                  : 'Sign in with a username and password.'
              }
            >
              <Select
                value={draft.authenticationMethod}
                onChange={(e) => set('authenticationMethod', e.target.value as Draft['authenticationMethod'])}
                options={AUTH_METHODS}
              />
            </FormField>
            <FormField
              label="Authentication required"
              help="Local addresses are only trusted when no proxy headers are present."
            >
              <Select
                value={draft.authenticationRequired}
                onChange={(e) => set('authenticationRequired', e.target.value as Draft['authenticationRequired'])}
                options={AUTH_REQUIRED}
              />
            </FormField>
            <FormField label="Username" error={field('username')}>
              <Input autoComplete="username" value={draft.username} onChange={(e) => set('username', e.target.value)} />
            </FormField>
            <FormField label="Password" error={field('password')} help="Leave blank to keep the current password.">
              <Input
                type="password"
                autoComplete="new-password"
                value={draft.password}
                onChange={(e) => set('password', e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="API key">
            <Input readOnly value={config.apiKey} className="font-mono" />
          </FormField>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button icon={<Copy />} onClick={copyKey}>
              Copy API key
            </Button>
            <Button icon={<RefreshCw />} onClick={() => setConfirmReset(true)}>
              Regenerate API key
            </Button>
          </div>
        </Card>

        <Card title="Logging">
          <FormField label="Log level" className="max-w-xs">
            <Select value={draft.logLevel} onChange={(e) => set('logLevel', e.target.value as Draft['logLevel'])} options={LOG_LEVELS} />
          </FormField>
        </Card>

        <div className="flex items-center justify-end gap-3">
          {otherError && (
            <p role="alert" className="mr-auto text-sm font-medium text-danger">
              {otherError}
            </p>
          )}
          <Button type="submit" variant="primary" icon={<Save />} loading={save.isPending} disabled={!dirty || hasClientErrors}>
            Save
          </Button>
        </div>
      </form>

      <ConfirmDialog
        open={confirmReset}
        title="Regenerate API key"
        message="Apps using the current API key will stop working until you update them. The page reloads afterwards."
        confirmLabel="Regenerate"
        loading={reset.isPending}
        onCancel={() => setConfirmReset(false)}
        onConfirm={() => reset.mutate()}
      />
    </>
  );
}

export function General() {
  const config = useHostConfig();
  return (
    <>
      <PageHeader title="General" description="Host, security and logging settings." />
      {config.isPending ? (
        <Spinner label="Loading settings" />
      ) : config.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(config.error)}
        </p>
      ) : (
        <GeneralForm config={config.data} />
      )}
    </>
  );
}
