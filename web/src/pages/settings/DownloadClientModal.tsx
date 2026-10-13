import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DownloadClientImplementation, DownloadClientInput, DownloadClientResource } from '@sonarr/shared';
import { ConfirmDialog, FormField, Input, Modal, Switch, useToast } from '../../components/ui';
import { api, queryKeys } from '../../lib/api';
import { TagPicker } from '../series/AddSeriesModal';
import {
  FormSection,
  ProviderFooter,
  otherServerError,
  parseIntIn,
  serverFieldError,
  useDeleteProvider,
  useSaveProvider,
  useTestProvider,
  type ProviderTemplateOption,
} from './IndexerModal';
import { useTags } from './hooks';

export const useDownloadClients = () =>
  useQuery({ queryKey: queryKeys.downloadClients, queryFn: () => api.get<DownloadClientResource[]>('downloadclient') });

export const useDownloadClientSchema = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.downloadClientSchema,
    queryFn: () => api.get<DownloadClientResource[]>('downloadclient/schema'),
    enabled,
  });

export const downloadClientTemplateOptions: Record<
  DownloadClientImplementation,
  Omit<ProviderTemplateOption, 'implementation' | 'protocol'>
> = {
  SABnzbd: { label: 'SABnzbd', description: 'Usenet downloader, connects with an API key.' },
  NZBGet: { label: 'NZBGet', description: 'Usenet downloader, connects with a username and password.' },
  QBittorrent: { label: 'qBittorrent', description: 'Torrent client, connects through the Web UI.' },
  Transmission: { label: 'Transmission', description: 'Torrent client, connects through its RPC interface.' },
};

/** Display name of an implementation ('QBittorrent' -> 'qBittorrent'). */
export const clientLabel = (impl: string) =>
  downloadClientTemplateOptions[impl as DownloadClientImplementation]?.label ?? impl;

/** SABnzbd authenticates with an API key; the others with username and password. */
export const usesApiKey = (impl: DownloadClientImplementation) => impl === 'SABnzbd';

const CLIENT_FIELDS = ['name', 'host', 'port', 'useSsl', 'urlBase', 'username', 'password', 'apiKey', 'category', 'priority', 'tags'];

export interface DownloadClientModalProps {
  /** The client to edit, or a schema template with id 0 to add one. */
  client: DownloadClientResource;
  onClose: () => void;
}

export function DownloadClientModal({ client, onClose }: DownloadClientModalProps) {
  const toast = useToast();
  const tags = useTags();
  const isNew = client.id === 0;
  const s = client.settings;
  const apiKeyAuth = usesApiKey(client.implementation);
  const label = clientLabel(client.implementation);

  const [name, setName] = useState(client.name);
  const [enable, setEnable] = useState(client.enable);
  const [host, setHost] = useState(s.host ?? 'localhost');
  const [port, setPort] = useState(String(s.port ?? ''));
  const [useSsl, setUseSsl] = useState(s.useSsl ?? false);
  const [urlBase, setUrlBase] = useState(s.urlBase ?? '');
  const [username, setUsername] = useState(s.username ?? '');
  const [password, setPassword] = useState(s.password ?? '');
  const [apiKey, setApiKey] = useState(s.apiKey ?? '');
  const [category, setCategory] = useState(s.category ?? '');
  const [priority, setPriority] = useState(String(client.priority ?? 1));
  const [removeCompleted, setRemoveCompleted] = useState(client.removeCompletedDownloads);
  const [removeFailed, setRemoveFailed] = useState(client.removeFailedDownloads);
  const [tagIds, setTagIds] = useState<number[]>(client.tags ?? []);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const keys = [queryKeys.downloadClients];
  const save = useSaveProvider<DownloadClientInput>('downloadclient', keys);
  const test = useTestProvider<DownloadClientInput>('downloadclient');
  const remove = useDeleteProvider('downloadclient', keys);

  const build = (): DownloadClientInput | null => {
    const next: Partial<Record<string, string>> = {};
    if (!name.trim()) next.name = 'Name is required';
    if (!host.trim()) next.host = 'Host is required';
    const portNumber = parseIntIn(port, 1, 65535);
    if (portNumber === null) next.port = 'Port must be a number from 1 to 65535';
    const prio = parseIntIn(priority, 1, 50);
    if (prio === null) next.priority = 'Priority must be a whole number from 1 to 50';
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return {
      name: name.trim(),
      implementation: client.implementation,
      enable,
      priority: prio!,
      removeCompletedDownloads: removeCompleted,
      removeFailedDownloads: removeFailed,
      tags: tagIds,
      settings: {
        host: host.trim(),
        port: portNumber!,
        useSsl,
        urlBase,
        // Only the credentials this client uses are sent; the others keep their stored values.
        username: apiKeyAuth ? (s.username ?? '') : username,
        password: apiKeyAuth ? (s.password ?? '') : password,
        apiKey: apiKeyAuth ? apiKey : (s.apiKey ?? ''),
        category,
      },
    };
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const input = build();
    if (!input) return;
    save.mutate(
      { id: client.id, input },
      {
        onSuccess: () => {
          toast.success(isNew ? `Added ${input.name}` : `Saved ${input.name}`);
          onClose();
        },
      },
    );
  };

  const onTest = () => {
    const input = build();
    if (input) test.mutate({ id: client.id, input });
  };

  const fieldError = (field: string) => errors[field] ?? serverFieldError(save.error, field);
  const otherError = otherServerError(save.error, CLIENT_FIELDS);
  const formId = 'download-client-form';

  return (
    <>
      <Modal
        open={!confirmDelete}
        onClose={onClose}
        title={isNew ? `Add Download Client - ${label}` : `Edit Download Client - ${client.name}`}
        size="lg"
        footer={
          <ProviderFooter
            formId={formId}
            isNew={isNew}
            saving={save.isPending}
            testing={test.isPending}
            onTest={onTest}
            onDelete={() => setConfirmDelete(true)}
            onCancel={onClose}
          />
        }
      >
        <form id={formId} onSubmit={onSubmit} noValidate className="flex flex-col gap-6">
          {otherError && (
            <p role="alert" className="text-sm font-medium text-danger">
              {otherError}
            </p>
          )}
          <FormSection title="General">
            <FormField label="Name" required error={fieldError('name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </FormField>
            <FormField label="Enable" inline help="Disabled clients are not used for new grabs.">
              <Switch checked={enable} onCheckedChange={setEnable} />
            </FormField>
          </FormSection>
          <FormSection title="Connection">
            <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
              <FormField label="Host" required error={fieldError('host')}>
                <Input value={host} onChange={(e) => setHost(e.target.value)} autoComplete="off" />
              </FormField>
              <FormField label="Port" required error={fieldError('port')}>
                <Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" autoComplete="off" />
              </FormField>
            </div>
            <FormField label="Use SSL" inline help={`Connect to ${label} over HTTPS.`}>
              <Switch checked={useSsl} onCheckedChange={setUseSsl} />
            </FormField>
            <FormField label="URL Base" error={fieldError('urlBase')} help={`Prefix added to the ${label} URL, e.g. /${label.toLowerCase()}`}>
              <Input value={urlBase} onChange={(e) => setUrlBase(e.target.value)} autoComplete="off" />
            </FormField>
            {apiKeyAuth ? (
              <FormField label="API Key" error={fieldError('apiKey')}>
                <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password" />
              </FormField>
            ) : (
              <>
                <FormField label="Username" error={fieldError('username')}>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
                </FormField>
                <FormField label="Password" error={fieldError('password')}>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                </FormField>
              </>
            )}
            <FormField label="Category" error={fieldError('category')} help="Downloads are added with this category so Sonarr only tracks its own.">
              <Input value={category} onChange={(e) => setCategory(e.target.value)} autoComplete="off" />
            </FormField>
          </FormSection>
          <FormSection title="Completed and failed downloads">
            <FormField label="Remove Completed" inline help="Remove imported downloads from the client history.">
              <Switch checked={removeCompleted} onCheckedChange={setRemoveCompleted} />
            </FormField>
            <FormField label="Remove Failed" inline help="Remove failed downloads from the client history.">
              <Switch checked={removeFailed} onCheckedChange={setRemoveFailed} />
            </FormField>
          </FormSection>
          <FormSection title="Advanced">
            <FormField label="Priority" error={fieldError('priority')} help="1 (highest) to 50 (lowest). The lowest value wins when several clients match.">
              <Input type="number" min={1} max={50} value={priority} onChange={(e) => setPriority(e.target.value)} />
            </FormField>
            <TagPicker tags={tags.data ?? []} value={tagIds} onChange={setTagIds} />
            {fieldError('tags') && <p className="text-xs font-medium text-danger">{fieldError('tags')}</p>}
          </FormSection>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete download client"
        message={`Delete the download client "${client.name}"?`}
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          remove.mutate(client.id, {
            onSuccess: () => {
              toast.success(`Deleted ${client.name}`);
              onClose();
            },
            onSettled: () => setConfirmDelete(false),
          })
        }
      />
    </>
  );
}
