import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { QUALITIES, type Episode, type ManualImportFile, type ManualImportItem, type Series } from '@sonarr/shared';
import { Button, EmptyState, Modal, Select, Spinner, Table, TBody, Td, Th, THead, Tr, Input } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../settings/hooks';
import { useEpisodes, useRunCommand, useSeriesList } from '../series/hooks';

export interface ManualImportModalProps {
  downloadId?: string;
  folder?: string;
  title: string;
  onClose: () => void;
}

type ImportMode = 'auto' | 'move' | 'copy';

interface RowEdit {
  checked?: boolean;
  seriesId?: number;
  seasonNumber?: number;
  episodeIds?: number[];
  qualityId?: number;
  releaseGroup?: string;
}

interface RowState {
  checked: boolean;
  seriesId?: number;
  seasonNumber?: number;
  episodeIds: number[];
  qualityId: number;
  releaseGroup: string;
}

const isImportable = (item: ManualImportItem) =>
  item.series !== undefined && item.episodes.length > 0 && item.rejections.length === 0;

function resolveRow(item: ManualImportItem, edit: RowEdit | undefined): RowState {
  const seriesId = edit?.seriesId ?? item.series?.id;
  const seriesChanged = edit?.seriesId !== undefined && edit.seriesId !== item.series?.id;
  const seasonNumber = edit?.seasonNumber ?? (seriesChanged ? undefined : (item.seasonNumber ?? item.episodes[0]?.seasonNumber));
  const seasonChanged = edit?.seasonNumber !== undefined && edit.seasonNumber !== (item.seasonNumber ?? item.episodes[0]?.seasonNumber);
  const episodeIds = edit?.episodeIds ?? (seriesChanged || seasonChanged ? [] : item.episodes.map((e) => e.id));
  return {
    checked: edit?.checked ?? isImportable(item),
    seriesId,
    seasonNumber,
    episodeIds,
    qualityId: edit?.qualityId ?? item.quality.quality.id,
    releaseGroup: edit?.releaseGroup ?? item.releaseGroup ?? '',
  };
}

function EpisodeSelect({
  label,
  seriesId,
  seasonNumber,
  value,
  onChange,
}: {
  label: string;
  seriesId?: number;
  seasonNumber?: number;
  value: number[];
  onChange: (ids: number[]) => void;
}) {
  const episodes = useEpisodes(seriesId);
  const options = (episodes.data ?? []).filter((e: Episode) => e.seasonNumber === seasonNumber);
  return (
    <Select
      multiple
      aria-label={label}
      size={Math.min(4, Math.max(2, options.length))}
      disabled={seriesId === undefined || seasonNumber === undefined}
      value={value.map(String)}
      onChange={(e) => onChange(Array.from(e.target.selectedOptions, (o) => Number(o.value)))}
      className="h-auto min-w-40"
    >
      {options.map((e) => (
        <option key={e.id} value={e.id}>
          {e.episodeNumber}. {e.title || 'TBA'}
        </option>
      ))}
    </Select>
  );
}

/** Maps files the automatic import rejected (or could not match) to episodes and imports them. */
export function ManualImportModal({ downloadId, folder, title, onClose }: ManualImportModalProps) {
  const listing = useQuery({
    queryKey: ['manualimport', downloadId, folder],
    queryFn: () => api.get<ManualImportItem[]>('manualimport', { query: { downloadId, folder } }),
    staleTime: 0,
    gcTime: 0,
  });
  const seriesList = useSeriesList();
  const run = useRunCommand();
  const [edits, setEdits] = useState<Record<number, RowEdit>>({});
  const [mode, setMode] = useState<ImportMode>('auto');

  const seriesById = useMemo(() => new Map<number, Series>((seriesList.data ?? []).map((s) => [s.id, s])), [seriesList.data]);
  const items = listing.data ?? [];
  const edit = (id: number, patch: RowEdit) => setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));

  const rows = items.map((item) => ({ item, state: resolveRow(item, edits[item.id]) }));
  const ready = rows.filter((r) => r.state.checked && r.state.seriesId !== undefined && r.state.episodeIds.length > 0);

  const submit = () => {
    const files: ManualImportFile[] = ready.map(({ item, state }) => ({
      path: item.path,
      seriesId: state.seriesId!,
      episodeIds: state.episodeIds,
      quality: {
        quality: QUALITIES.find((q) => q.id === state.qualityId) ?? item.quality.quality,
        revision: item.quality.revision,
      },
      ...(state.releaseGroup ? { releaseGroup: state.releaseGroup } : {}),
      ...((item.downloadId ?? downloadId) ? { downloadId: item.downloadId ?? downloadId } : {}),
    }));
    run.mutate(
      { name: 'ManualImport', body: { files, importMode: mode }, label: `manual import of ${files.length} ${files.length === 1 ? 'file' : 'files'}` },
      { onSuccess: onClose },
    );
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="Manual import"
      description={title}
      size="xl"
      footer={
        <>
          <div className="mr-auto flex items-center gap-2">
            <label htmlFor="manual-import-mode" className="text-sm text-text">
              Import mode
            </label>
            <Select
              id="manual-import-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as ImportMode)}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'move', label: 'Move' },
                { value: 'copy', label: 'Copy' },
              ]}
              className="w-32"
            />
          </div>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={ready.length === 0} loading={run.isPending} onClick={submit}>
            Import {ready.length} {ready.length === 1 ? 'file' : 'files'}
          </Button>
        </>
      }
    >
      {listing.isPending ? (
        <Spinner label="Loading files" />
      ) : listing.isError ? (
        <div role="alert" className="flex items-center gap-3 text-sm text-danger">
          <span>Could not load files: {errorMessage(listing.error)}</span>
          <Button size="sm" onClick={() => void listing.refetch()}>
            Retry
          </Button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No video files found" description="There is nothing to import in this location." />
      ) : (
        <Table caption="Files to import" captionHidden>
          <THead>
            <Tr>
              <Th className="w-10">
                <span className="sr-only">Import</span>
              </Th>
              <Th>File</Th>
              <Th>Series</Th>
              <Th>Season</Th>
              <Th>Episodes</Th>
              <Th>Quality</Th>
              <Th>Release group</Th>
            </Tr>
          </THead>
          <TBody>
            {rows.map(({ item, state }) => {
              const series = state.seriesId !== undefined ? seriesById.get(state.seriesId) : undefined;
              const seasons = (series?.seasons ?? []).map((s) => s.seasonNumber);
              if (state.seasonNumber !== undefined && !seasons.includes(state.seasonNumber)) seasons.push(state.seasonNumber);
              return (
                <Tr key={item.id}>
                  <Td>
                    <input
                      type="checkbox"
                      aria-label={`Import ${item.relativePath}`}
                      checked={state.checked}
                      onChange={(e) => edit(item.id, { checked: e.target.checked })}
                      className="focus-ring size-4 rounded border-control-border accent-accent"
                    />
                  </Td>
                  <Td className="max-w-64 min-w-40">
                    <p className="font-mono text-xs break-all text-text">{item.relativePath}</p>
                    {item.rejections.length > 0 && (
                      <ul aria-label={`Rejections for ${item.relativePath}`} className="mt-1 list-disc pl-4 text-xs text-warning">
                        {item.rejections.map((r, i) => (
                          <li key={i}>{r.reason}</li>
                        ))}
                      </ul>
                    )}
                  </Td>
                  <Td>
                    <Select
                      aria-label={`Series for ${item.relativePath}`}
                      value={state.seriesId ?? ''}
                      onChange={(e) =>
                        edit(item.id, { seriesId: Number(e.target.value), seasonNumber: undefined, episodeIds: [], checked: true })
                      }
                    >
                      <option value="" disabled>
                        Select series
                      </option>
                      {(seriesList.data ?? []).map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.title}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <Select
                      aria-label={`Season for ${item.relativePath}`}
                      value={state.seasonNumber ?? ''}
                      disabled={state.seriesId === undefined}
                      onChange={(e) => edit(item.id, { seasonNumber: Number(e.target.value), episodeIds: [], seriesId: state.seriesId })}
                    >
                      <option value="" disabled>
                        Season
                      </option>
                      {seasons.map((n) => (
                        <option key={n} value={n}>
                          {n === 0 ? 'Specials' : `Season ${n}`}
                        </option>
                      ))}
                    </Select>
                  </Td>
                  <Td>
                    <EpisodeSelect
                      label={`Episodes for ${item.relativePath}`}
                      seriesId={state.seriesId}
                      seasonNumber={state.seasonNumber}
                      value={state.episodeIds}
                      onChange={(ids) => edit(item.id, { episodeIds: ids, seriesId: state.seriesId, seasonNumber: state.seasonNumber })}
                    />
                  </Td>
                  <Td>
                    <Select
                      aria-label={`Quality for ${item.relativePath}`}
                      value={state.qualityId}
                      onChange={(e) => edit(item.id, { qualityId: Number(e.target.value) })}
                      options={QUALITIES.map((q) => ({ value: q.id, label: q.name }))}
                    />
                  </Td>
                  <Td>
                    <Input
                      aria-label={`Release group for ${item.relativePath}`}
                      value={state.releaseGroup}
                      onChange={(e) => edit(item.id, { releaseGroup: e.target.value })}
                      className="w-32"
                    />
                  </Td>
                </Tr>
              );
            })}
          </TBody>
        </Table>
      )}
    </Modal>
  );
}
