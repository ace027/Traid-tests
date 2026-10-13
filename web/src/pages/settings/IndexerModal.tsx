import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { FlaskConical, Trash2 } from 'lucide-react';
import type { IndexerImplementation, IndexerInput, IndexerResource, Protocol } from '@sonarr/shared';
import { Badge, Button, ConfirmDialog, FormField, Input, Modal, Spinner, Switch, useToast } from '../../components/ui';
import { ApiError, api, queryKeys } from '../../lib/api';
import { TagPicker } from '../series/AddSeriesModal';
import { errorMessage, useTags } from './hooks';

/** Placeholder the server returns for stored secrets; sending it back keeps the stored value. */
export const MASKED = '********';


export interface IndexerStatus {
  indexerId: number;
  disabledTill?: string | null;
  mostRecentFailure?: string | null;
}

/** One entry of POST <provider>/testall. */
export interface ProviderTestResult {
  id: number;
  isValid: boolean;
  validationFailures?: { propertyName?: string; errorMessage: string }[];
}

export const useIndexers = () =>
  useQuery({ queryKey: queryKeys.indexers, queryFn: () => api.get<IndexerResource[]>('indexer') });

export const useIndexerSchema = (enabled = true) =>
  useQuery({ queryKey: queryKeys.indexerSchema, queryFn: () => api.get<IndexerResource[]>('indexer/schema'), enabled });

export const useIndexerStatus = () =>
  useQuery({ queryKey: queryKeys.indexerStatus, queryFn: () => api.get<IndexerStatus[]>('indexerstatus') });

/** Create (id 0) or update a provider; errors are shown inline by the modal. */
export function useSaveProvider<TInput>(resource: 'indexer' | 'downloadclient', keys: QueryKey[]) {
  const qc = useQueryClient();
  return useMutation<unknown, unknown, { id: number; input: TInput }>({
    mutationFn: ({ id, input }) => (id ? api.put(`${resource}/${id}`, { ...input, id }) : api.post(resource, input)),
    onSuccess: () => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey }))),
  });
}

export function useDeleteProvider(resource: 'indexer' | 'downloadclient', keys: QueryKey[]) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation<unknown, unknown, number>({
    mutationFn: (id) => api.del(`${resource}/${id}`),
    onSuccess: () => Promise.all(keys.map((queryKey) => qc.invalidateQueries({ queryKey }))),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/** POST <provider>/test; toasts the outcome with the server's message. */
export function useTestProvider<TInput>(resource: 'indexer' | 'downloadclient') {
  const toast = useToast();
  return useMutation<unknown, unknown, { id: number; input: TInput }>({
    mutationFn: ({ id, input }) => api.post(`${resource}/test`, id ? { ...input, id } : input),
    onSuccess: () => toast.success('Test succeeded'),
    onError: (error) => toast.error(`Test failed: ${errorMessage(error)}`),
  });
}

/** POST <provider>/testall; toasts which providers failed. */
export function useTestAllProviders(resource: 'indexer' | 'downloadclient', names: (id: number) => string) {
  const toast = useToast();
  return useMutation<ProviderTestResult[], unknown, void>({
    mutationFn: () => api.post<ProviderTestResult[]>(`${resource}/testall`),
    onSuccess: (results) => {
      const failed = (results ?? []).filter((r) => !r.isValid);
      if (failed.length === 0) {
        toast.success('All tests passed');
        return;
      }
      for (const r of failed) {
        toast.error(`${names(r.id)}: ${r.validationFailures?.[0]?.errorMessage ?? 'Test failed'}`);
      }
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}


export function ProtocolBadge({ protocol }: { protocol: Protocol }) {
  return <Badge variant={protocol === 'usenet' ? 'info' : 'accent'}>{protocol === 'usenet' ? 'Usenet' : 'Torrent'}</Badge>;
}

export interface ProviderTemplateOption {
  implementation: string;
  label: string;
  description: string;
  protocol: Protocol;
}

/** First step of the add flow: choose an implementation. */
export function ProviderTemplatePicker({
  open,
  title,
  options,
  loading,
  error,
  onRetry,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  options: ProviderTemplateOption[];
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  onPick: (implementation: string) => void;
  onClose: () => void;
}) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="lg">
      {loading ? (
        <Spinner label="Loading templates" />
      ) : error ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-danger">
          <span>{errorMessage(error)}</span>
          <Button size="sm" onClick={onRetry}>
            Retry
          </Button>
        </div>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {options.map((o) => (
            <li key={o.implementation}>
              <button
                type="button"
                onClick={() => onPick(o.implementation)}
                className="focus-ring flex h-full w-full flex-col items-start gap-2 rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:border-accent/50 hover:bg-surface-hover"
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="font-semibold text-text">{o.label}</span>
                  <ProtocolBadge protocol={o.protocol} />
                </span>
                <span className="text-sm text-text-muted">{o.description}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Matches a server validation error to a field, with or without a 'settings.' prefix. */
export function serverFieldError(error: unknown, name: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  return error.fieldError(name) ?? error.fieldError(`settings.${name}`);
}

/** Message for a failed save that does not belong to one of `fields`. */
export function otherServerError(error: unknown, fields: string[]): string | undefined {
  if (!error) return undefined;
  if (error instanceof ApiError && error.errors.length > 0) {
    const known = new Set(fields.flatMap((f) => [f.toLowerCase(), `settings.${f}`.toLowerCase()]));
    const rest = error.errors.filter((e) => !known.has(e.propertyName.toLowerCase()));
    return rest.length ? rest.map((e) => e.errorMessage).join(' ') : undefined;
  }
  return errorMessage(error);
}

/** Footer for provider modals: Delete (edit only) on the left; Test, Cancel and Save on the right. */
export function ProviderFooter({
  formId,
  isNew,
  saving,
  testing,
  onTest,
  onDelete,
  onCancel,
}: {
  formId: string;
  isNew: boolean;
  saving: boolean;
  testing: boolean;
  onTest: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex w-full flex-wrap items-center gap-2">
      {!isNew && (
        <Button variant="danger" icon={<Trash2 aria-hidden="true" />} onClick={onDelete}>
          Delete
        </Button>
      )}
      <div className="ml-auto flex flex-wrap gap-2">
        <Button icon={<FlaskConical aria-hidden="true" />} loading={testing} onClick={onTest}>
          Test
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" type="submit" form={formId} loading={saving}>
          Save
        </Button>
      </div>
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-4">
      <legend className="mb-2 text-xs font-semibold tracking-wide text-text-muted uppercase">{title}</legend>
      {children}
    </fieldset>
  );
}

/** Parses '1, 2' as [1, 2]; returns null when an entry is not a whole number. */
export function parseNumberList(value: string): number[] | null {
  const parts = value
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.map(Number);
}

/** Whole number in [min, max] or null. */
export function parseIntIn(value: string, min: number, max: number): number | null {
  if (!/^\s*\d+\s*$/.test(value)) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

export const isHttpUrl = (v: string) => {
  try {
    const u = new URL(v.trim());
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
};


export const indexerTemplateOptions: Record<IndexerImplementation, Omit<ProviderTemplateOption, 'implementation' | 'protocol'>> = {
  Newznab: { label: 'Newznab', description: 'Usenet indexers that speak the Newznab API.' },
  Torznab: { label: 'Torznab', description: 'Torrent indexers through the Torznab API (Jackett, Prowlarr).' },
};

const INDEXER_FIELDS = ['name', 'baseUrl', 'apiPath', 'apiKey', 'categories', 'animeCategories', 'minimumSeeders', 'seedRatio', 'seedTime', 'priority', 'tags'];

type Errors = Partial<Record<string, string>>;

export interface IndexerModalProps {
  /** The indexer to edit, or a schema template with id 0 to add one. */
  indexer: IndexerResource;
  onClose: () => void;
}

export function IndexerModal({ indexer, onClose }: IndexerModalProps) {
  const toast = useToast();
  const tags = useTags();
  const isNew = indexer.id === 0;
  const isTorznab = indexer.implementation === 'Torznab';
  const s = indexer.settings;

  const [name, setName] = useState(indexer.name);
  const [enableRss, setEnableRss] = useState(indexer.enableRss);
  const [enableAutomaticSearch, setEnableAutomaticSearch] = useState(indexer.enableAutomaticSearch);
  const [enableInteractiveSearch, setEnableInteractiveSearch] = useState(indexer.enableInteractiveSearch);
  const [baseUrl, setBaseUrl] = useState(s.baseUrl ?? '');
  const [apiPath, setApiPath] = useState(s.apiPath ?? '/api');
  const [apiKey, setApiKey] = useState(s.apiKey ?? '');
  const [categories, setCategories] = useState((s.categories ?? []).join(', '));
  const [animeCategories, setAnimeCategories] = useState((s.animeCategories ?? []).join(', '));
  const [minimumSeeders, setMinimumSeeders] = useState(String(s.minimumSeeders ?? 1));
  const [seedRatio, setSeedRatio] = useState(s.seedRatio === null || s.seedRatio === undefined ? '' : String(s.seedRatio));
  const [seedTime, setSeedTime] = useState(s.seedTime === null || s.seedTime === undefined ? '' : String(s.seedTime));
  const [priority, setPriority] = useState(String(indexer.priority ?? 25));
  const [tagIds, setTagIds] = useState<number[]>(indexer.tags ?? []);
  const [errors, setErrors] = useState<Errors>({});
  const [confirmDelete, setConfirmDelete] = useState(false);

  const keys = [queryKeys.indexers, queryKeys.indexerStatus];
  const save = useSaveProvider<IndexerInput>('indexer', keys);
  const test = useTestProvider<IndexerInput>('indexer');
  const remove = useDeleteProvider('indexer', keys);

  /** Validates the form; returns the request body or null (and shows field errors). */
  const build = (): IndexerInput | null => {
    const next: Errors = {};
    if (!name.trim()) next.name = 'Name is required';
    if (!isHttpUrl(baseUrl)) next.baseUrl = 'Enter a valid http(s) URL';
    const cats = parseNumberList(categories);
    if (!cats) next.categories = 'Use comma-separated numbers, e.g. 5030, 5040';
    const animeCats = parseNumberList(animeCategories);
    if (!animeCats) next.animeCategories = 'Use comma-separated numbers, e.g. 5070';
    const prio = parseIntIn(priority, 1, 50);
    if (prio === null) next.priority = 'Priority must be a whole number from 1 to 50';
    const seeders = parseIntIn(minimumSeeders, 0, Number.MAX_SAFE_INTEGER);
    if (isTorznab && seeders === null) next.minimumSeeders = 'Must be a whole number of 0 or more';
    const ratio = seedRatio.trim() === '' ? null : Number(seedRatio);
    if (isTorznab && ratio !== null && (!Number.isFinite(ratio) || ratio < 0)) next.seedRatio = 'Must be a number of 0 or more';
    const time = seedTime.trim() === '' ? null : parseIntIn(seedTime, 0, Number.MAX_SAFE_INTEGER);
    if (isTorznab && seedTime.trim() !== '' && time === null) next.seedTime = 'Must be a whole number of minutes';
    setErrors(next);
    if (Object.keys(next).length > 0) return null;
    return {
      name: name.trim(),
      implementation: indexer.implementation,
      enableRss,
      enableAutomaticSearch,
      enableInteractiveSearch,
      priority: prio!,
      tags: tagIds,
      settings: {
        baseUrl: baseUrl.trim(),
        apiPath,
        apiKey,
        categories: cats!,
        animeCategories: animeCats!,
        minimumSeeders: isTorznab ? seeders! : (s.minimumSeeders ?? 1),
        seedRatio: isTorznab ? ratio : (s.seedRatio ?? null),
        seedTime: isTorznab ? time : (s.seedTime ?? null),
      },
    };
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    const input = build();
    if (!input) return;
    save.mutate(
      { id: indexer.id, input },
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
    if (input) test.mutate({ id: indexer.id, input });
  };

  const fieldError = (field: string) => errors[field] ?? serverFieldError(save.error, field);
  const otherError = otherServerError(save.error, INDEXER_FIELDS);
  const formId = 'indexer-form';

  return (
    <>
      <Modal
        open={!confirmDelete}
        onClose={onClose}
        title={isNew ? `Add Indexer - ${indexer.implementation}` : `Edit Indexer - ${indexer.name}`}
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
            <FormField label="Enable RSS" inline help="Use this indexer for the periodic RSS sync.">
              <Switch checked={enableRss} onCheckedChange={setEnableRss} />
            </FormField>
            <FormField label="Enable Automatic Search" inline help="Used by automatic and scheduled searches.">
              <Switch checked={enableAutomaticSearch} onCheckedChange={setEnableAutomaticSearch} />
            </FormField>
            <FormField label="Enable Interactive Search" inline help="Used when you search manually for releases.">
              <Switch checked={enableInteractiveSearch} onCheckedChange={setEnableInteractiveSearch} />
            </FormField>
          </FormSection>
          <FormSection title="Connection">
            <FormField label="URL" required error={fieldError('baseUrl')} help="For example https://indexer.example.com">
              <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} inputMode="url" autoComplete="off" />
            </FormField>
            <FormField label="API Path" error={fieldError('apiPath')} help="Path to the API, usually /api">
              <Input value={apiPath} onChange={(e) => setApiPath(e.target.value)} autoComplete="off" />
            </FormField>
            <FormField label="API Key" error={fieldError('apiKey')}>
              <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="new-password" />
            </FormField>
            <FormField
              label="Categories"
              error={fieldError('categories')}
              help="Comma-separated category ids. Leave empty to use the defaults."
            >
              <Input value={categories} onChange={(e) => setCategories(e.target.value)} inputMode="numeric" autoComplete="off" />
            </FormField>
            <FormField label="Anime Categories" error={fieldError('animeCategories')} help="Comma-separated category ids used for anime series.">
              <Input value={animeCategories} onChange={(e) => setAnimeCategories(e.target.value)} inputMode="numeric" autoComplete="off" />
            </FormField>
          </FormSection>
          {isTorznab && (
            <FormSection title="Seeding">
              <FormField label="Minimum Seeders" error={fieldError('minimumSeeders')} help="Releases with fewer seeders are rejected.">
                <Input value={minimumSeeders} onChange={(e) => setMinimumSeeders(e.target.value)} inputMode="numeric" />
              </FormField>
              <FormField label="Seed Ratio" error={fieldError('seedRatio')} help="Stored, not enforced yet.">
                <Input value={seedRatio} onChange={(e) => setSeedRatio(e.target.value)} inputMode="decimal" />
              </FormField>
              <FormField label="Seed Time (minutes)" error={fieldError('seedTime')} help="Stored, not enforced yet.">
                <Input value={seedTime} onChange={(e) => setSeedTime(e.target.value)} inputMode="numeric" />
              </FormField>
            </FormSection>
          )}
          <FormSection title="Advanced">
            <FormField label="Priority" error={fieldError('priority')} help="1 (highest) to 50 (lowest). Used to break ties between equal releases.">
              <Input type="number" min={1} max={50} value={priority} onChange={(e) => setPriority(e.target.value)} />
            </FormField>
            <TagPicker tags={tags.data ?? []} value={tagIds} onChange={setTagIds} />
            {fieldError('tags') && <p className="text-xs font-medium text-danger">{fieldError('tags')}</p>}
          </FormSection>
        </form>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete indexer"
        message={`Delete the indexer "${indexer.name}"?`}
        loading={remove.isPending}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() =>
          remove.mutate(indexer.id, {
            onSuccess: () => {
              toast.success(`Deleted ${indexer.name}`);
              onClose();
            },
            onSettled: () => setConfirmDelete(false),
          })
        }
      />
    </>
  );
}
