import { useState } from 'react';
import { Download, FlaskConical, Plus } from 'lucide-react';
import { downloadClientImplementations, type DownloadClientImplementation, type DownloadClientResource } from '@sonarr/shared';
import { Badge, Button, Card, EmptyState, FormField, PageHeader, Spinner, Switch } from '../../components/ui';
import { useDownloadClientConfig, useSaveDownloadClientConfig } from './mediaHooks';
import {
  DownloadClientModal,
  clientLabel,
  downloadClientTemplateOptions,
  useDownloadClientSchema,
  useDownloadClients,
} from './DownloadClientModal';
import { ProtocolBadge, ProviderTemplatePicker, useTestAllProviders } from './IndexerModal';
import { FeatureChip, ProviderCard } from './Indexers';
import { errorMessage } from './hooks';

function CompletedDownloadHandling() {
  const config = useDownloadClientConfig();
  const save = useSaveDownloadClientConfig();
  return (
    <Card title="Completed Download Handling" description="How Sonarr imports and recovers downloads." className="mb-5">
      {config.isPending ? (
        <Spinner label="Loading download handling settings" />
      ) : config.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(config.error)}
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          <FormField label="Enable" help="Import completed downloads from the download client." inline>
            <Switch
              checked={config.data.enableCompletedDownloadHandling}
              disabled={save.isPending}
              onCheckedChange={(v) => save.mutate({ enableCompletedDownloadHandling: v })}
            />
          </FormField>
          <FormField label="Redownload failed" help="Search for a different release when a download fails." inline>
            <Switch
              checked={config.data.autoRedownloadFailed}
              disabled={save.isPending}
              onCheckedChange={(v) => save.mutate({ autoRedownloadFailed: v })}
            />
          </FormField>
        </div>
      )}
    </Card>
  );
}

export function DownloadClients() {
  const clients = useDownloadClients();
  const [picking, setPicking] = useState(false);
  const schema = useDownloadClientSchema(picking);
  const [editing, setEditing] = useState<DownloadClientResource | null>(null);
  const testAll = useTestAllProviders('downloadclient', (id) => clients.data?.find((c) => c.id === id)?.name ?? `Client ${id}`);

  const pick = (implementation: string) => {
    const template = schema.data?.find((t) => t.implementation === implementation);
    if (!template) return;
    setPicking(false);
    setEditing({ ...template, id: 0, name: template.name ?? '' });
  };

  const templateOptions = (schema.data ?? [])
    .filter((t) => (downloadClientImplementations as readonly string[]).includes(t.implementation))
    .map((t) => ({
      implementation: t.implementation,
      protocol: t.protocol,
      ...downloadClientTemplateOptions[t.implementation as DownloadClientImplementation],
    }));

  return (
    <>
      <PageHeader
        title="Download Clients"
        description="Download clients receive the releases Sonarr grabs."
        actions={
          <>
            <Button
              icon={<FlaskConical aria-hidden="true" />}
              loading={testAll.isPending}
              disabled={!clients.data?.length}
              onClick={() => testAll.mutate()}
            >
              Test All
            </Button>
            <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setPicking(true)}>
              Add Download Client
            </Button>
          </>
        }
      />
      <CompletedDownloadHandling />
      {clients.isPending ? (
        <Spinner label="Loading download clients" />
      ) : clients.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-danger">
          <span>{errorMessage(clients.error)}</span>
          <Button size="sm" onClick={() => void clients.refetch()}>
            Retry
          </Button>
        </div>
      ) : clients.data.length === 0 ? (
        <EmptyState
          icon={<Download />}
          title="No download clients"
          description="Add SABnzbd, NZBGet, qBittorrent or Transmission so Sonarr can send releases to it."
          action={
            <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setPicking(true)}>
              Add Download Client
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Download clients">
          {clients.data.map((client) => (
            <li key={client.id}>
              <ProviderCard
                name={client.name}
                subtitle={`${clientLabel(client.implementation)} at ${client.settings.host}:${client.settings.port}`}
                onOpen={() => setEditing(client)}
              >
                <ProtocolBadge protocol={client.protocol} />
                <FeatureChip on={client.enable} stateText={false}>{client.enable ? 'Enabled' : 'Disabled'}</FeatureChip>
                <Badge variant="neutral">Priority {client.priority}</Badge>
                {client.settings.category && <Badge variant="neutral">Category {client.settings.category}</Badge>}
              </ProviderCard>
            </li>
          ))}
        </ul>
      )}
      <ProviderTemplatePicker
        open={picking}
        title="Add Download Client"
        options={templateOptions}
        loading={schema.isPending}
        error={schema.isError ? schema.error : null}
        onRetry={() => void schema.refetch()}
        onPick={pick}
        onClose={() => setPicking(false)}
      />
      {editing && <DownloadClientModal key={editing.id} client={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
