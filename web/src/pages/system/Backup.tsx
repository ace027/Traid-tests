import { useEffect, useRef, useState } from 'react';
import { Archive, Download, History as RestoreIcon, Plus, RotateCw, Trash2, Upload } from 'lucide-react';
import type { BackupResource, BackupType } from '@sonarr/shared';
import { Badge, Button, Card, ConfirmDialog, EmptyState, PageHeader, TBody, THead, Table, Td, Th, Tr, useToast, type BadgeVariant } from '../../components/ui';
import { loadInitialize } from '../../lib/api';
import { DateCell, LoadError, SkeletonRows } from '../activity/History';
import {
  downloadApiFile,
  errorMessage,
  formatBytes,
  useBackups,
  useCreateBackup,
  useDeleteBackup,
  useRestart,
  useRestoreBackup,
  useUploadRestore,
  waitForRestart,
} from './hooks';

const typeBadge: Record<BackupType, { variant: BadgeVariant; label: string }> = {
  manual: { variant: 'accent', label: 'Manual' },
  scheduled: { variant: 'info', label: 'Scheduled' },
  update: { variant: 'neutral', label: 'Update' },
};

const COLUMNS = 5;

type Pending =
  | { kind: 'delete'; backup: BackupResource }
  | { kind: 'restore'; backup: BackupResource }
  | { kind: 'upload'; file: File }
  | { kind: 'restart' };

const replaceWarning =
  'The current database will be replaced by the backup when Sonarr restarts. Changes made since the backup was taken will be lost. A restart is required to finish the restore.';

function RestartBanner({ onRestart, restarting }: { onRestart: () => void; restarting: boolean }) {
  return (
    <div
      role="status"
      className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm text-warning"
    >
      <span className="font-medium">
        {restarting ? 'Restarting... the page reloads when Sonarr is back.' : 'Restart required: the restored backup is applied when Sonarr restarts.'}
      </span>
      <Button size="sm" icon={<RotateCw aria-hidden="true" />} onClick={onRestart} loading={restarting}>
        {restarting ? 'Restarting...' : 'Restart'}
      </Button>
    </div>
  );
}

export function Backup() {
  const toast = useToast();
  const backups = useBackups();
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [restartRequired, setRestartRequired] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);
  const stopPolling = useRef<(() => void) | null>(null);

  useEffect(() => () => stopPolling.current?.(), []);

  const close = () => setPending(null);
  const onRestored = () => {
    close();
    setRestartRequired(true);
    toast.success('Backup staged for restore. Restart Sonarr to apply it.');
  };

  const create = useCreateBackup({ onSuccess: () => toast.success('Backup created') });
  const remove = useDeleteBackup({ onSuccess: close });
  const restore = useRestoreBackup({ onSuccess: onRestored });
  const upload = useUploadRestore({ onSuccess: onRestored });
  const restart = useRestart({
    onSuccess: () => {
      close();
      setRestarting(true);
      void loadInitialize()
        .then((c) => c.urlBase)
        .catch(() => '')
        .then((urlBase) => {
          stopPolling.current = waitForRestart(urlBase);
        });
    },
  });

  const download = async (b: BackupResource) => {
    setDownloading(b.name);
    try {
      await downloadApiFile(`system/backup/${encodeURIComponent(b.name)}/download`, b.name);
    } catch (error) {
      toast.error(`Download failed: ${errorMessage(error)}`);
    } finally {
      setDownloading(null);
    }
  };

  const onFileChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) setPending({ kind: 'upload', file });
  };

  const confirm = () => {
    if (!pending) return;
    if (pending.kind === 'delete') remove.mutate(pending.backup.name);
    else if (pending.kind === 'restore') restore.mutate(pending.backup.name);
    else if (pending.kind === 'upload') upload.mutate(pending.file);
    else restart.mutate();
  };

  const busy = remove.isPending || restore.isPending || upload.isPending || restart.isPending;
  const list = backups.data ?? [];

  return (
    <>
      <PageHeader
        title="Backup"
        actions={
          <>
            <Button variant="primary" icon={<Plus aria-hidden="true" />} loading={create.isPending} onClick={() => create.mutate()}>
              Backup now
            </Button>
            <Button icon={<Upload aria-hidden="true" />} onClick={() => fileRef.current?.click()} disabled={upload.isPending}>
              Restore backup
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".zip,application/zip"
              className="sr-only"
              tabIndex={-1}
              aria-label="Backup file to restore"
              data-testid="restore-file"
              onChange={onFileChosen}
            />
          </>
        }
      />

      {(restartRequired || restarting) && (
        <RestartBanner restarting={restarting} onRestart={() => setPending({ kind: 'restart' })} />
      )}

      {backups.isError && !backups.data ? (
        <LoadError what="backups" error={backups.error} onRetry={() => void backups.refetch()} />
      ) : !backups.isPending && list.length === 0 ? (
        <EmptyState
          icon={<Archive />}
          title="No backups yet"
          description="Backups are created every week. Create one now before making big changes."
        />
      ) : (
        <Card flush aria-busy={backups.isPending || undefined}>
          <Table caption="Backups" captionHidden>
            <THead>
              <tr>
                <Th>Name</Th>
                <Th>Type</Th>
                <Th>Size</Th>
                <Th>Time</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </THead>
            <TBody>
              {backups.isPending ? (
                <SkeletonRows columns={COLUMNS} />
              ) : (
                list.map((b) => {
                  const t = typeBadge[b.type] ?? typeBadge.manual;
                  return (
                    <Tr key={`${b.type}/${b.name}`}>
                      <Td className="font-medium break-all">{b.name}</Td>
                      <Td>
                        <Badge variant={t.variant}>{t.label}</Badge>
                      </Td>
                      <Td className="whitespace-nowrap">{formatBytes(b.size)}</Td>
                      <Td>
                        <DateCell iso={b.time} />
                      </Td>
                      <Td className="text-right whitespace-nowrap">
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Download ${b.name}`}
                          icon={<Download aria-hidden="true" />}
                          loading={downloading === b.name}
                          onClick={() => void download(b)}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Restore ${b.name}`}
                          icon={<RestoreIcon aria-hidden="true" />}
                          onClick={() => setPending({ kind: 'restore', backup: b })}
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Delete ${b.name}`}
                          icon={<Trash2 aria-hidden="true" />}
                          onClick={() => setPending({ kind: 'delete', backup: b })}
                        />
                      </Td>
                    </Tr>
                  );
                })
              )}
            </TBody>
          </Table>
        </Card>
      )}

      <ConfirmDialog
        open={pending?.kind === 'delete'}
        title="Delete backup"
        message={pending?.kind === 'delete' ? `Delete the backup ${pending.backup.name}? This cannot be undone.` : ''}
        confirmLabel="Delete"
        loading={remove.isPending}
        onConfirm={confirm}
        onCancel={close}
      />
      <ConfirmDialog
        open={pending?.kind === 'restore' || pending?.kind === 'upload'}
        title="Restore backup"
        message={
          <>
            <p className="mb-2 font-medium break-all text-text">
              {pending?.kind === 'restore' ? pending.backup.name : pending?.kind === 'upload' ? pending.file.name : ''}
            </p>
            <p>{replaceWarning}</p>
          </>
        }
        confirmLabel="Restore"
        loading={restore.isPending || upload.isPending}
        onConfirm={confirm}
        onCancel={close}
      />
      <ConfirmDialog
        open={pending?.kind === 'restart'}
        title="Restart Sonarr"
        message="Sonarr will restart and be unavailable for a moment. Running tasks are interrupted."
        confirmLabel="Restart"
        danger={false}
        loading={restart.isPending}
        onConfirm={confirm}
        onCancel={() => !busy && close()}
      />
    </>
  );
}
