import { useEffect, useState } from 'react';
import { Ban, Trash2 } from 'lucide-react';
import type { BlocklistResource } from '@sonarr/shared';
import { Badge, Button, ConfirmDialog, EmptyState, PageHeader, TBody, THead, Table, Td, Th, Tr } from '../../components/ui';
import { ProtocolBadge } from '../settings/IndexerModal';
import { DateCell, LoadError, Pager, SeriesLink, SkeletonRows, useSeriesById } from './History';
import { useBlocklist, useRemoveBlocklist, useRemoveBlocklistBulk, type BlocklistParams } from './historyHooks';

export const BLOCKLIST_PAGE_SIZE = 20;

const COLUMN_COUNT = 9;

export function Blocklist() {
  const [params, setParams] = useState<BlocklistParams>({
    page: 1,
    pageSize: BLOCKLIST_PAGE_SIZE,
    sortKey: 'date',
    sortDirection: 'descending',
  });
  const blocklist = useBlocklist(params);
  const seriesById = useSeriesById();
  const removeOne = useRemoveBlocklist();
  const removeMany = useRemoveBlocklistBulk();
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [toRemove, setToRemove] = useState<BlocklistResource[]>([]);

  const records = blocklist.data?.records ?? [];
  const total = blocklist.data?.totalRecords ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize));

  // Drop selections for rows that are gone.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(records.map((r) => r.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [records]);

  useEffect(() => {
    if (blocklist.data && params.page > totalPages) setParams((p) => ({ ...p, page: totalPages }));
  }, [blocklist.data, params.page, totalPages]);

  const allSelected = records.length > 0 && records.every((r) => selected.has(r.id));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(records.map((r) => r.id)));
  const toggleOne = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirmRemove = () => {
    if (toRemove.length === 1) {
      removeOne.mutate({ id: toRemove[0].id, title: toRemove[0].sourceTitle }, { onSuccess: () => setToRemove([]) });
    } else {
      removeMany.mutate(
        { ids: toRemove.map((r) => r.id) },
        {
          onSuccess: () => {
            setToRemove([]);
            setSelected(new Set());
          },
        },
      );
    }
  };

  return (
    <>
      <PageHeader
        title="Blocklist"
        description="Releases Sonarr will not grab again."
        actions={
          <Button
            variant="danger"
            icon={<Trash2 aria-hidden="true" />}
            disabled={selected.size === 0}
            onClick={() => setToRemove(records.filter((r) => selected.has(r.id)))}
          >
            Remove selected{selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
        }
      />

      {blocklist.isError && !blocklist.data ? (
        <LoadError what="the blocklist" error={blocklist.error} onRetry={() => void blocklist.refetch()} />
      ) : blocklist.data && records.length === 0 ? (
        <EmptyState
          icon={<Ban />}
          title="Blocklist is empty"
          description="Failed or rejected releases are added here so they are not grabbed again."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-sm">
          {blocklist.isPending && (
            <p role="status" className="sr-only">
              Loading blocklist
            </p>
          )}
          <Table caption="Blocklist" captionHidden aria-busy={blocklist.isPending || undefined}>
            <THead>
              <tr>
                <Th className="w-10">
                  <input
                    type="checkbox"
                    aria-label="Select all"
                    checked={allSelected}
                    disabled={records.length === 0}
                    onChange={toggleAll}
                    className="focus-ring size-4 rounded border-control-border accent-accent"
                  />
                </Th>
                <Th>Series</Th>
                <Th>Source Title</Th>
                <Th>Quality</Th>
                <Th>Protocol</Th>
                <Th>Indexer</Th>
                <Th>Date</Th>
                <Th>Message</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {blocklist.isPending ? (
                <SkeletonRows columns={COLUMN_COUNT} />
              ) : (
                records.map((item) => (
                  <Tr key={item.id} data-testid={`blocklist-${item.id}`}>
                    <Td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${item.sourceTitle}`}
                        checked={selected.has(item.id)}
                        onChange={() => toggleOne(item.id)}
                        className="focus-ring size-4 rounded border-control-border accent-accent"
                      />
                    </Td>
                    <Td className="min-w-40">
                      <SeriesLink series={seriesById.get(item.seriesId)} seriesId={item.seriesId} />
                    </Td>
                    <Td className="max-w-96 min-w-56 break-words [overflow-wrap:anywhere]">{item.sourceTitle}</Td>
                    <Td>
                      <Badge variant="neutral">{item.quality?.quality?.name ?? 'Unknown'}</Badge>
                    </Td>
                    <Td>
                      <ProtocolBadge protocol={item.protocol} />
                    </Td>
                    <Td className="whitespace-nowrap">{item.indexer || '-'}</Td>
                    <Td>
                      <DateCell iso={item.date} />
                    </Td>
                    <Td className="max-w-72 min-w-40 text-text-muted">{item.message || '-'}</Td>
                    <Td>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove ${item.sourceTitle} from the blocklist`}
                        title="Remove"
                        icon={<Trash2 aria-hidden="true" />}
                        onClick={() => setToRemove([item])}
                      />
                    </Td>
                  </Tr>
                ))
              )}
            </TBody>
          </Table>
          <Pager
            label="Blocklist pages"
            page={params.page}
            totalRecords={total}
            pageSize={params.pageSize}
            noun={['release', 'releases']}
            onPage={(page) => setParams((p) => ({ ...p, page }))}
          />
        </div>
      )}

      <ConfirmDialog
        open={toRemove.length > 0}
        title={toRemove.length === 1 ? 'Remove from blocklist' : `Remove ${toRemove.length} releases`}
        message={
          toRemove.length === 1
            ? `Remove ${toRemove[0].sourceTitle} from the blocklist? Sonarr may grab it again.`
            : `Remove ${toRemove.length} releases from the blocklist? Sonarr may grab them again.`
        }
        confirmLabel="Remove"
        loading={removeOne.isPending || removeMany.isPending}
        onConfirm={confirmRemove}
        onCancel={() => setToRemove([])}
      />
    </>
  );
}
