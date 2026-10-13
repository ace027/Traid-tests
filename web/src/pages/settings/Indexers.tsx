import { useState, type ReactNode } from 'react';
import { Check, FlaskConical, Plus, Rss, TriangleAlert, X } from 'lucide-react';
import { indexerImplementations, type IndexerImplementation, type IndexerResource } from '@sonarr/shared';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner } from '../../components/ui';
import {
  IndexerModal,
  ProtocolBadge,
  ProviderTemplatePicker,
  indexerTemplateOptions,
  useIndexerSchema,
  useIndexerStatus,
  useIndexers,
  useTestAllProviders,
} from './IndexerModal';
import { errorMessage } from './hooks';

/** Enabled/disabled chip that reads as text (and an icon shape), not only colour. */
export function FeatureChip({ on, children, stateText = true }: { on: boolean; children: ReactNode; stateText?: boolean }) {
  return (
    <Badge variant={on ? 'success' : 'neutral'} className={on ? undefined : 'line-through decoration-text-muted/60'}>
      {on ? <Check aria-hidden="true" className="size-3" /> : <X aria-hidden="true" className="size-3" />}
      {children}
      {stateText && <span className="sr-only">{on ? ' enabled' : ' disabled'}</span>}
    </Badge>
  );
}

/** Card whose title is a button that covers the whole card. */
export function ProviderCard({
  name,
  subtitle,
  onOpen,
  children,
}: {
  name: string;
  subtitle: ReactNode;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <Card
      className="relative h-full transition-colors focus-within:border-accent/60 hover:border-border-strong"
      headingLevel={2}
      title={
        <button
          type="button"
          onClick={onOpen}
          aria-label={`Edit ${name}`}
          className="focus-ring rounded-sm text-left break-words after:absolute after:inset-0 after:content-['']"
        >
          {name}
        </button>
      }
      description={subtitle}
    >
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </Card>
  );
}

function disabledUntil(iso: string | null | undefined, now = Date.now()): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) || d.getTime() <= now ? null : d;
}

export function Indexers() {
  const indexers = useIndexers();
  const status = useIndexerStatus();
  const [picking, setPicking] = useState(false);
  const schema = useIndexerSchema(picking);
  const [editing, setEditing] = useState<IndexerResource | null>(null);
  const testAll = useTestAllProviders('indexer', (id) => indexers.data?.find((i) => i.id === id)?.name ?? `Indexer ${id}`);

  const pick = (implementation: string) => {
    const template = schema.data?.find((t) => t.implementation === implementation);
    if (!template) return;
    setPicking(false);
    setEditing({ ...template, id: 0, name: template.name ?? '' });
  };

  const templateOptions = (schema.data ?? [])
    .filter((t) => (indexerImplementations as readonly string[]).includes(t.implementation))
    .map((t) => ({ implementation: t.implementation, protocol: t.protocol, ...indexerTemplateOptions[t.implementation as IndexerImplementation] }));

  return (
    <>
      <PageHeader
        title="Indexers"
        description="Indexers are the sites Sonarr searches for releases."
        actions={
          <>
            <Button
              icon={<FlaskConical aria-hidden="true" />}
              loading={testAll.isPending}
              disabled={!indexers.data?.length}
              onClick={() => testAll.mutate()}
            >
              Test All
            </Button>
            <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setPicking(true)}>
              Add Indexer
            </Button>
          </>
        }
      />
      {indexers.isPending ? (
        <Spinner label="Loading indexers" />
      ) : indexers.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-danger">
          <span>{errorMessage(indexers.error)}</span>
          <Button size="sm" onClick={() => void indexers.refetch()}>
            Retry
          </Button>
        </div>
      ) : indexers.data.length === 0 ? (
        <EmptyState
          icon={<Rss />}
          title="No indexers"
          description="Add a Newznab or Torznab indexer so Sonarr can find releases."
          action={
            <Button variant="primary" icon={<Plus aria-hidden="true" />} onClick={() => setPicking(true)}>
              Add Indexer
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Indexers">
          {indexers.data.map((indexer) => {
            const until = disabledUntil(status.data?.find((st) => st.indexerId === indexer.id)?.disabledTill);
            return (
              <li key={indexer.id}>
                <ProviderCard
                  name={indexer.name}
                  subtitle={indexer.implementation}
                  onOpen={() => setEditing(indexer)}
                >
                  <ProtocolBadge protocol={indexer.protocol} />
                  <FeatureChip on={indexer.enableRss}>RSS</FeatureChip>
                  <FeatureChip on={indexer.enableAutomaticSearch}>Automatic Search</FeatureChip>
                  <FeatureChip on={indexer.enableInteractiveSearch}>Interactive Search</FeatureChip>
                  <Badge variant="neutral">Priority {indexer.priority}</Badge>
                  {until && (
                    <Badge variant="warning" title={`Disabled after failures until ${until.toLocaleString()}`}>
                      <TriangleAlert aria-hidden="true" className="size-3" />
                      Disabled until {until.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}
                    </Badge>
                  )}
                </ProviderCard>
              </li>
            );
          })}
        </ul>
      )}
      <ProviderTemplatePicker
        open={picking}
        title="Add Indexer"
        options={templateOptions}
        loading={schema.isPending}
        error={schema.isError ? schema.error : null}
        onRetry={() => void schema.refetch()}
        onPick={pick}
        onClose={() => setPicking(false)}
      />
      {editing && <IndexerModal key={editing.id} indexer={editing} onClose={() => setEditing(null)} />}
    </>
  );
}
