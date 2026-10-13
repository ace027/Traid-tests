import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { RenamePreview } from '@sonarr/shared';
import { Button, EmptyState, Modal, Spinner } from '../../components/ui';
import { api } from '../../lib/api';
import { errorMessage } from '../settings/hooks';
import { useRunCommand } from './hooks';
import { useNamingConfig } from '../settings/mediaHooks';

export interface RenamePreviewModalProps {
  seriesId: number;
  seasonNumber?: number;
  onClose: () => void;
}

/** Previews the file renames the current naming format would apply, and runs them. */
export function RenamePreviewModal({ seriesId, seasonNumber, onClose }: RenamePreviewModalProps) {
  const preview = useQuery({
    queryKey: ['rename', seriesId, seasonNumber],
    queryFn: () => api.get<RenamePreview[]>('rename', { query: { seriesId, seasonNumber } }),
    staleTime: 0,
    gcTime: 0,
  });
  const naming = useNamingConfig();
  const run = useRunCommand();
  const [unchecked, setUnchecked] = useState<Set<number>>(new Set());

  const items = preview.data ?? [];
  const selected = items.filter((p) => !unchecked.has(p.episodeFileId));
  const toggle = (id: number) =>
    setUnchecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const submit = () =>
    run.mutate(
      {
        name: 'RenameFiles',
        body: { seriesId, files: selected.map((p) => p.episodeFileId) },
        label: `rename of ${selected.length} ${selected.length === 1 ? 'file' : 'files'}`,
      },
      { onSuccess: onClose },
    );

  return (
    <Modal
      open
      onClose={onClose}
      title="Preview rename"
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={selected.length === 0} loading={run.isPending} onClick={submit}>
            Organize {selected.length} {selected.length === 1 ? 'file' : 'files'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {naming.data && (
          <p className="text-sm text-text-muted">
            Naming format:{' '}
            <code className="font-mono text-xs text-text">{naming.data.standardEpisodeFormat}</code>.{' '}
            <Link to="/settings/mediamanagement" className="focus-ring rounded-sm text-accent hover:underline">
              Change in Settings &gt; Media Management
            </Link>
          </p>
        )}
        {preview.isPending ? (
          <Spinner label="Loading rename preview" />
        ) : preview.isError ? (
          <div role="alert" className="flex items-center gap-3 text-sm text-danger">
            <span>Could not load the preview: {errorMessage(preview.error)}</span>
            <Button size="sm" onClick={() => void preview.refetch()}>
              Retry
            </Button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState title="All episodes are already named correctly" description="No files need to be renamed." />
        ) : (
          <ul aria-label="Files to rename" className="flex flex-col divide-y divide-border">
            {items.map((p) => (
              <li key={p.episodeFileId} className="flex items-start gap-3 py-2">
                <input
                  type="checkbox"
                  aria-label={`Rename ${p.existingPath}`}
                  checked={!unchecked.has(p.episodeFileId)}
                  onChange={() => toggle(p.episodeFileId)}
                  className="focus-ring mt-1 size-4 shrink-0 rounded border-control-border accent-accent"
                />
                <div className="min-w-0 font-mono text-xs break-all">
                  <p className="text-text-muted line-through">{p.existingPath}</p>
                  <p className="font-medium text-success">{p.newPath}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
