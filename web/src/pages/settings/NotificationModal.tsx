import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  NOTIFICATION_EVENT_FLAGS,
  notificationImplementations,
  type NotificationEventFlag,
  type NotificationImplementation,
  type NotificationInput,
  type NotificationResource,
} from '@sonarr/shared';
import { ConfirmDialog, FormField, Input, Modal, Select, Switch, useToast } from '../../components/ui';
import { api, queryKeys } from '../../lib/api';
import { TagPicker } from '../series/AddSeriesModal';
import { errorMessage, useTags } from './hooks';
import {
  FormSection,
  MASKED,
  ProviderFooter,
  ProviderTemplatePicker,
  isHttpUrl,
  otherServerError,
  parseIntIn,
  serverFieldError,
} from './IndexerModal';

export const triggerLabels: Record<NotificationEventFlag, string> = {
  onGrab: 'On Grab',
  onDownload: 'On Import',
  onUpgrade: 'On Upgrade',
  onRename: 'On Rename',
  onSeriesAdd: 'On Series Add',
  onSeriesDelete: 'On Series Delete',
  onEpisodeFileDelete: 'On File Delete',
  onEpisodeFileDeleteForUpgrade: 'On File Delete For Upgrade',
  onHealthIssue: 'On Health Issue',
  onHealthRestored: 'On Health Restored',
};

export const notificationTemplateOptions: Record<NotificationImplementation, { label: string; description: string }> = {
  Webhook: { label: 'Webhook', description: 'Send a JSON payload to any HTTP endpoint.' },
  Discord: { label: 'Discord', description: 'Post messages to a Discord channel through a webhook.' },
  Email: { label: 'Email', description: 'Send email through an SMTP server.' },
};

export const useNotifications = () =>
  useQuery({ queryKey: queryKeys.notifications, queryFn: () => api.get<NotificationResource[]>('notification') });

export const useNotificationSchema = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.notificationSchema,
    queryFn: () => api.get<NotificationResource[]>('notification/schema'),
    enabled,
  });

function useSaveNotification() {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { id: number; input: NotificationInput }>({
    mutationFn: ({ id, input }) => (id ? api.put(`notification/${id}`, { ...input, id }) : api.post('notification', input)),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications }),
  });
}

function useDeleteNotification() {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<unknown, unknown, number>({
    mutationFn: (id) => api.del(`notification/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.notifications }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

function useTestNotification() {
  const toast = useToast();
  return useMutation<unknown, unknown, { id: number; input: NotificationInput }>({
    mutationFn: ({ id, input }) => api.post('notification/test', id ? { ...input, id } : input),
    onSuccess: () => toast.success('Test succeeded'),
    onError: (error) => toast.error(`Test failed: ${errorMessage(error)}`),
  });
}

export function NotificationTemplatePicker({
  open,
  schema,
  onPick,
  onClose,
}: {
  open: boolean;
  schema: ReturnType<typeof useNotificationSchema>;
  onPick: (template: NotificationResource) => void;
  onClose: () => void;
}) {
  const options = (schema.data ?? [])
    .filter((t) => (notificationImplementations as readonly string[]).includes(t.implementation))
    .map((t) => ({
      implementation: t.implementation,
      protocol: 'usenet' as const,
      ...notificationTemplateOptions[t.implementation],
    }));
  return (
    <ProviderTemplatePicker
      open={open}
      title="Add Connection"
      options={options}
      loading={schema.isPending}
      error={schema.isError ? schema.error : null}
      onRetry={() => void schema.refetch()}
      onPick={(implementation) => {
        const template = schema.data?.find((t) => t.implementation === implementation);
        if (template) onPick(template);
      }}
      onClose={onClose}
    />
  );
}

const parseAddresses = (value: string) =>
  value
    .split(/[,;]/)
    .map((p) => p.trim())
    .filter(Boolean);
const isEmail = (v: string) => /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(v);
const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : fallback);
const list = (v: unknown) => (Array.isArray(v) ? v.join(', ') : '');

type Errors = Partial<Record<string, string>>;

const ENCRYPTION = [
  { value: 'always', label: 'Always' },
  { value: 'preferred', label: 'Preferred' },
  { value: 'never', label: 'Never' },
];

const FIELDS = [
  'name', 'url', 'method', 'username', 'password', 'webHookUrl', 'avatar', 'server', 'port',
  'useEncryption', 'from', 'to', 'cc', 'bcc', 'tags',
];

export function NotificationModal({ notification, onClose }: { notification: NotificationResource; onClose: () => void }) {
  const toast = useToast();
  const tags = useTags();
  const isNew = notification.id === 0;
  const impl = notification.implementation;
  const s = notification.settings ?? {};

  const [name, setName] = useState(notification.name);
  const [flags, setFlags] = useState<Record<NotificationEventFlag, boolean>>(
    () => Object.fromEntries(NOTIFICATION_EVENT_FLAGS.map((f) => [f, Boolean(notification[f])])) as Record<NotificationEventFlag, boolean>,
  );
  const [includeHealthWarnings, setIncludeHealthWarnings] = useState(notification.includeHealthWarnings);
  const [tagIds, setTagIds] = useState<number[]>(notification.tags ?? []);
  // webhook
  const [url, setUrl] = useState(str(s.url));
  const [method, setMethod] = useState(str(s.method, 'POST'));
  const [username, setUsername] = useState(str(s.username));
  const [password, setPassword] = useState(str(s.password));
  // discord
  const [webHookUrl, setWebHookUrl] = useState(str(s.webHookUrl));
  const [avatar, setAvatar] = useState(str(s.avatar));
  // email
  const [server, setServer] = useState(str(s.server));
  const [port, setPort] = useState(String(s.port ?? 587));
  const [useEncryption, setUseEncryption] = useState(str(s.useEncryption, 'preferred'));
  const [from, setFrom] = useState(str(s.from));
  const [to, setTo] = useState(list(s.to));
  const [cc, setCc] = useState(list(s.cc));
  const [bcc, setBcc] = useState(list(s.bcc));

  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = useSaveNotification();
  const test = useTestNotification();
  const remove = useDeleteNotification();

  const build = (): NotificationInput | null => {
    const next: Errors = {};
    if (!name.trim()) next.name = 'Name is required';
    let settings: Record<string, unknown> = {};
    if (impl === 'Webhook') {
      if (!isHttpUrl(url)) next.url = 'Enter a valid http(s) URL';
      settings = { url: url.trim(), method, username, password };
    } else if (impl === 'Discord') {
      if (webHookUrl !== MASKED && !isHttpUrl(webHookUrl)) next.webHookUrl = 'Enter a valid http(s) URL';
      settings = { webHookUrl: webHookUrl.trim(), username, avatar };
    } else {
      if (!server.trim()) next.server = 'Server is required';
      const p = parseIntIn(port, 1, 65535);
      if (p === null) next.port = 'Port must be a number from 1 to 65535';
      if (!isEmail(from.trim())) next.from = 'Enter a valid email address';
      const toList = parseAddresses(to);
      const ccList = parseAddresses(cc);
      const bccList = parseAddresses(bcc);
      if (toList.length === 0) next.to = 'At least one recipient is required';
      else if (toList.some((a) => !isEmail(a))) next.to = 'Every recipient must be a valid email address';
      if (ccList.some((a) => !isEmail(a))) next.cc = 'Every address must be a valid email address';
      if (bccList.some((a) => !isEmail(a))) next.bcc = 'Every address must be a valid email address';
      settings = {
        server: server.trim(), port: p ?? 587, useEncryption, username, password, from: from.trim(),
        to: toList, cc: ccList, bcc: bccList,
      };
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return {
      name: name.trim(),
      implementation: impl,
      ...flags,
      includeHealthWarnings,
      tags: tagIds,
      settings,
    } as NotificationInput;
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const input = build();
    if (!input) return;
    save.mutate(
      { id: notification.id, input },
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
    if (input) test.mutate({ id: notification.id, input });
  };

  const fieldError = (field: string) => errors[field] ?? serverFieldError(save.error, field);
  const otherError = otherServerError(save.error, FIELDS);
  const formId = 'notification-form';

  return (
    <>
      <Modal
        open={!confirmDelete}
        onClose={onClose}
        title={isNew ? `Add Connection - ${impl}` : `Edit Connection - ${notification.name}`}
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
          <FormSection title="Name">
            <FormField label="Name" required error={fieldError('name')}>
              <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </FormField>
          </FormSection>
          <FormSection title="Notification Triggers">
            {NOTIFICATION_EVENT_FLAGS.map((f) => (
              <FormField key={f} label={triggerLabels[f]} inline>
                <Switch checked={flags[f]} onCheckedChange={(v) => setFlags((prev) => ({ ...prev, [f]: v }))} />
              </FormField>
            ))}
            <FormField label="Include Health Warnings" inline help="Also notify for health warnings, not only errors.">
              <Switch checked={includeHealthWarnings} onCheckedChange={setIncludeHealthWarnings} />
            </FormField>
          </FormSection>
          <FormSection title="Settings">
            {impl === 'Webhook' && (
              <>
                <FormField label="URL" required error={fieldError('url')}>
                  <Input value={url} onChange={(e) => setUrl(e.target.value)} inputMode="url" autoComplete="off" />
                </FormField>
                <FormField label="Method" error={fieldError('method')}>
                  <Select
                    value={method}
                    onChange={(e) => setMethod(e.target.value)}
                    options={[{ value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }]}
                  />
                </FormField>
                <FormField label="Username" error={fieldError('username')}>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
                </FormField>
                <FormField label="Password" error={fieldError('password')}>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                </FormField>
              </>
            )}
            {impl === 'Discord' && (
              <>
                <FormField label="Webhook URL" required error={fieldError('webHookUrl')}>
                  <Input type="password" value={webHookUrl} onChange={(e) => setWebHookUrl(e.target.value)} autoComplete="new-password" />
                </FormField>
                <FormField label="Username" error={fieldError('username')}>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
                </FormField>
                <FormField label="Avatar URL" error={fieldError('avatar')}>
                  <Input value={avatar} onChange={(e) => setAvatar(e.target.value)} inputMode="url" autoComplete="off" />
                </FormField>
              </>
            )}
            {impl === 'Email' && (
              <>
                <FormField label="Server" required error={fieldError('server')}>
                  <Input value={server} onChange={(e) => setServer(e.target.value)} autoComplete="off" />
                </FormField>
                <FormField label="Port" error={fieldError('port')}>
                  <Input value={port} onChange={(e) => setPort(e.target.value)} inputMode="numeric" />
                </FormField>
                <FormField label="Encryption" error={fieldError('useEncryption')}>
                  <Select value={useEncryption} onChange={(e) => setUseEncryption(e.target.value)} options={ENCRYPTION} />
                </FormField>
                <FormField label="Username" error={fieldError('username')}>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="off" />
                </FormField>
                <FormField label="Password" error={fieldError('password')}>
                  <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
                </FormField>
                <FormField label="From Address" required error={fieldError('from')}>
                  <Input value={from} onChange={(e) => setFrom(e.target.value)} inputMode="email" autoComplete="off" />
                </FormField>
                <FormField label="To" required error={fieldError('to')} help="Comma-separated email addresses.">
                  <Input value={to} onChange={(e) => setTo(e.target.value)} autoComplete="off" />
                </FormField>
                <FormField label="Cc" error={fieldError('cc')} help="Comma-separated email addresses.">
                  <Input value={cc} onChange={(e) => setCc(e.target.value)} autoComplete="off" />
                </FormField>
                <FormField label="Bcc" error={fieldError('bcc')} help="Comma-separated email addresses.">
                  <Input value={bcc} onChange={(e) => setBcc(e.target.value)} autoComplete="off" />
                </FormField>
              </>
            )}
          </FormSection>
          <FormSection title="Tags">
            <TagPicker tags={tags.data ?? []} value={tagIds} onChange={setTagIds} />
            {fieldError('tags') && <p className="text-xs font-medium text-danger">{fieldError('tags')}</p>}
          </FormSection>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete connection"
        message={`Delete the connection "${notification.name}"?`}
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          remove.mutate(notification.id, {
            onSuccess: () => {
              toast.success(`Deleted ${notification.name}`);
              onClose();
            },
            onSettled: () => setConfirmDelete(false),
          })
        }
      />
    </>
  );
}
