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

interface Draft {
  bindAddress: string;
  port: string;
  urlBase: string;
  instanceName: string;
  logLevel: HostConfig['logLevel'];
}

const toDraft = (c: HostConfig): Draft => ({
  bindAddress: c.bindAddress,
  port: String(c.port),
  urlBase: c.urlBase,
  instanceName: c.instanceName,
  logLevel: c.logLevel,
});

function GeneralForm({ config }: { config: HostConfig }) {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(config));
  const [confirmReset, setConfirmReset] = useState(false);
  const save = useUpdateHostConfig({ onSuccess: () => toast.success('General settings saved') });
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
    urlBase: draft.urlBase === '' || draft.urlBase.startsWith('/') ? undefined : "URL base must be empty or start with '/'",
    instanceName: draft.instanceName.trim() ? undefined : 'Instance name is required',
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

        <Card title="Security" description="Use the API key to connect other apps to Sonarr.">
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
