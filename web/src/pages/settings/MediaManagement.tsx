import { useState, type FormEvent } from 'react';
import { downloadPropersAndRepacksOptions, fileDateOptions, type MediaManagementConfig, type NamingConfig } from '@sonarr/shared';
import { FolderPlus, Trash2, TriangleAlert } from 'lucide-react';
import type { RootFolder } from '@sonarr/shared';
import { ApiError } from '../../lib/api';
import { Badge, Button, Card, ConfirmDialog, EmptyState, FormField, Input, PageHeader, Select, Spinner, Switch, Table, TBody, Td, Th, THead, Tr, useToast } from '../../components/ui';
import { errorMessage, formatBytes, useAddRootFolder, useDeleteRootFolder, useRootFolders } from './hooks';
import { NamingSettings } from './NamingSettings';
import { useMediaManagementConfig, useNamingConfig, useSaveMediaManagementConfig, useSaveNamingConfig } from './mediaHooks';

const propersLabels: Record<(typeof downloadPropersAndRepacksOptions)[number], string> = {
  preferAndUpgrade: 'Prefer and upgrade',
  doNotUpgrade: 'Do not upgrade automatically',
  doNotPrefer: 'Do not prefer',
};
const fileDateLabels: Record<(typeof fileDateOptions)[number], string> = {
  none: 'None',
  localAirDate: 'Local air date',
  utcAirDate: 'UTC air date',
};

function SwitchRow({ label, help, checked, onChange }: { label: string; help?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <FormField label={label} help={help} inline>
      <Switch checked={checked} onCheckedChange={onChange} />
    </FormField>
  );
}

export function MediaManagement() {
  const toast = useToast();
  const mmQuery = useMediaManagementConfig();
  const namingQuery = useNamingConfig();
  const [mmEdits, setMmEdits] = useState<Partial<MediaManagementConfig>>({});
  const [namingEdits, setNamingEdits] = useState<Partial<NamingConfig>>({});
  const saveMm = useSaveMediaManagementConfig();
  const saveNaming = useSaveNamingConfig();
  const mm = mmQuery.data ? { ...mmQuery.data, ...mmEdits } : undefined;
  const naming = namingQuery.data ? { ...namingQuery.data, ...namingEdits } : undefined;
  const dirty = Object.keys(mmEdits).length > 0 || Object.keys(namingEdits).length > 0;
  const setMm = (patch: Partial<MediaManagementConfig>) => {
    saveMm.reset();
    setMmEdits((e) => ({ ...e, ...patch }));
  };
  const setNaming = (patch: Partial<NamingConfig>) => {
    saveNaming.reset();
    setNamingEdits((e) => ({ ...e, ...patch }));
  };
  const saving = saveMm.isPending || saveNaming.isPending;

  const save = async () => {
    try {
      if (Object.keys(mmEdits).length > 0) {
        await saveMm.mutateAsync(mmEdits);
        setMmEdits({});
      }
      if (Object.keys(namingEdits).length > 0) {
        await saveNaming.mutateAsync(namingEdits);
        setNamingEdits({});
      }
      toast.success('Media management settings saved');
    } catch {
      // Errors are shown inline next to the fields.
    }
  };
  const mmField = (key: string) => (saveMm.error instanceof ApiError ? saveMm.error.fieldError(key) : undefined);
  const generalError =
    (saveMm.error && !(saveMm.error instanceof ApiError && saveMm.error.errors.length > 0) ? errorMessage(saveMm.error) : undefined) ??
    (saveNaming.error && !(saveNaming.error instanceof ApiError && saveNaming.error.errors.length > 0) ? errorMessage(saveNaming.error) : undefined);

  const folders = useRootFolders();
  const [path, setPath] = useState('');
  const [toDelete, setToDelete] = useState<RootFolder | null>(null);

  const add = useAddRootFolder({
    onSuccess: () => {
      setPath('');
      toast.success('Root folder added');
    },
  });
  const remove = useDeleteRootFolder({
    onSuccess: () => {
      setToDelete(null);
      toast.success('Root folder removed');
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (path.trim()) add.mutate(path.trim());
  };

  const addError = add.error
    ? add.error instanceof ApiError
      ? (add.error.fieldError('path') ?? errorMessage(add.error))
      : errorMessage(add.error)
    : undefined;

  return (
    <>
      <PageHeader title="Media Management" description="Where Sonarr finds and stores your series." />
      <Card title="Root Folders" description="Series are added to one of these folders." flush>
        {folders.isPending ? (
          <div className="p-5">
            <Spinner label="Loading root folders" />
          </div>
        ) : folders.isError ? (
          <p role="alert" className="p-5 text-sm text-danger">
            {errorMessage(folders.error)}
          </p>
        ) : folders.data.length === 0 ? (
          <div className="p-5">
            <EmptyState icon={<FolderPlus />} title="No root folders" description="Add a root folder below to start adding series." />
          </div>
        ) : (
          <Table caption="Root folders" captionHidden>
            <THead>
              <Tr>
                <Th>Path</Th>
                <Th>Free space</Th>
                <Th>Status</Th>
                <Th className="text-right">
                  <span className="sr-only">Actions</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {folders.data.map((folder) => (
                <Tr key={folder.id}>
                  <Td className="font-mono text-xs">{folder.path}</Td>
                  <Td>{folder.accessible ? formatBytes(folder.freeSpace) : 'Unknown'}</Td>
                  <Td>
                    {folder.accessible ? (
                      <Badge variant="success" dot>
                        Accessible
                      </Badge>
                    ) : (
                      <Badge variant="warning">
                        <TriangleAlert aria-hidden="true" className="size-3.5" />
                        Inaccessible
                      </Badge>
                    )}
                  </Td>
                  <Td className="text-right">
                    <Button variant="ghost" size="sm" aria-label={`Delete ${folder.path}`} onClick={() => setToDelete(folder)} icon={<Trash2 />}>
                      Delete
                    </Button>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        )}
        <form onSubmit={onSubmit} className="flex flex-wrap items-start gap-3 border-t border-border p-5" noValidate>
          <FormField label="New root folder path" error={addError} className="min-w-64 flex-1">
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="/tv" autoComplete="off" />
          </FormField>
          <Button type="submit" variant="primary" className="mt-6" loading={add.isPending} disabled={!path.trim()} icon={<FolderPlus />}>
            Add root folder
          </Button>
        </form>
      </Card>
      {mmQuery.isPending || namingQuery.isPending ? (
        <div className="mt-5">
          <Spinner label="Loading media management settings" />
        </div>
      ) : mm && naming ? (
        <div className="mt-5 flex flex-col gap-5">
          <Card title="Episode Naming" description="How imported files and folders are named.">
            <NamingSettings value={naming} onChange={setNaming} saveError={saveNaming.error} />
          </Card>
          <Card title="Folders">
            <div className="flex flex-col gap-4">
              <SwitchRow label="Create empty series folders" help="Create folders for series that have no files yet." checked={mm.createEmptySeriesFolders} onChange={(v) => setMm({ createEmptySeriesFolders: v })} />
              <SwitchRow label="Delete empty folders" help="Delete empty series and season folders after files are removed." checked={mm.deleteEmptyFolders} onChange={(v) => setMm({ deleteEmptyFolders: v })} />
            </div>
          </Card>
          <Card title="Importing">
            <div className="flex flex-col gap-4">
              <SwitchRow label="Skip free space check" help="Import even when there is not enough free space." checked={mm.skipFreeSpaceCheckWhenImporting} onChange={(v) => setMm({ skipFreeSpaceCheckWhenImporting: v })} />
              <FormField label="Minimum free space (MB)" help="Do not import when it would leave less free space than this." error={mmField('minimumFreeSpaceWhenImporting')}>
                <Input
                  type="number"
                  min={0}
                  value={mm.minimumFreeSpaceWhenImporting}
                  disabled={mm.skipFreeSpaceCheckWhenImporting}
                  onChange={(e) => setMm({ minimumFreeSpaceWhenImporting: Number(e.target.value) })}
                />
              </FormField>
              <SwitchRow label="Use hardlinks instead of copy" help="Hardlink torrents that are still seeding instead of copying them." checked={mm.copyUsingHardlinks} onChange={(v) => setMm({ copyUsingHardlinks: v })} />
              <SwitchRow label="Import extra files" help="Import matching extra files, such as subtitles, next to the episode." checked={mm.importExtraFiles} onChange={(v) => setMm({ importExtraFiles: v })} />
              {mm.importExtraFiles && (
                <FormField label="Extra file extensions" help="Comma separated list, for example srt,nfo" error={mmField('extraFileExtensions')}>
                  <Input value={mm.extraFileExtensions} onChange={(e) => setMm({ extraFileExtensions: e.target.value })} autoComplete="off" />
                </FormField>
              )}
            </div>
          </Card>
          <Card title="File Management">
            <div className="flex flex-col gap-4">
              <SwitchRow label="Unmonitor deleted episodes" help="Episodes deleted from disk are unmonitored automatically." checked={mm.autoUnmonitorPreviouslyDownloadedEpisodes} onChange={(v) => setMm({ autoUnmonitorPreviouslyDownloadedEpisodes: v })} />
              <FormField label="Propers and repacks">
                <Select
                  value={mm.downloadPropersAndRepacks}
                  onChange={(e) => setMm({ downloadPropersAndRepacks: e.target.value as MediaManagementConfig['downloadPropersAndRepacks'] })}
                  options={downloadPropersAndRepacksOptions.map((v) => ({ value: v, label: propersLabels[v] }))}
                />
              </FormField>
              <FormField label="Change file date">
                <Select
                  value={mm.fileDate}
                  onChange={(e) => setMm({ fileDate: e.target.value as MediaManagementConfig['fileDate'] })}
                  options={fileDateOptions.map((v) => ({ value: v, label: fileDateLabels[v] }))}
                />
              </FormField>
              <FormField label="Recycle bin" help="Deleted files go here instead of being removed. Leave empty to delete permanently." error={mmField('recycleBin')}>
                <Input value={mm.recycleBin} onChange={(e) => setMm({ recycleBin: e.target.value })} placeholder="/recycle" autoComplete="off" />
              </FormField>
              <FormField label="Recycle bin cleanup (days)" help="0 disables automatic cleanup." error={mmField('recycleBinCleanupDays')}>
                <Input type="number" min={0} max={365} value={mm.recycleBinCleanupDays} onChange={(e) => setMm({ recycleBinCleanupDays: Number(e.target.value) })} />
              </FormField>
            </div>
          </Card>
          <Card title="Permissions">
            <div className="flex flex-col gap-4">
              <SwitchRow label="Set permissions" help="Apply chmod to folders created by Sonarr." checked={mm.setPermissionsLinux} onChange={(v) => setMm({ setPermissionsLinux: v })} />
              {mm.setPermissionsLinux && (
                <FormField label="chmod folder" help="Octal mode, for example 755" error={mmField('chmodFolder')}>
                  <Input value={mm.chmodFolder} onChange={(e) => setMm({ chmodFolder: e.target.value })} autoComplete="off" />
                </FormField>
              )}
            </div>
          </Card>
          <div className="sticky bottom-0 z-10 flex items-center justify-end gap-3 border-t border-border bg-surface px-4 py-3">
            {generalError && (
              <p role="alert" className="mr-auto text-sm text-danger">
                {generalError}
              </p>
            )}
            <Button variant="primary" disabled={!dirty} loading={saving} onClick={() => void save()}>
              Save
            </Button>
          </div>
        </div>
      ) : (
        <p role="alert" className="mt-5 text-sm text-danger">
          {errorMessage(mmQuery.error ?? namingQuery.error)}
        </p>
      )}
      <ConfirmDialog
        open={toDelete !== null}
        title="Delete root folder"
        message={
          <>
            Remove <span className="font-mono">{toDelete?.path}</span> from Sonarr? Files on disk are not deleted.
          </>
        }
        loading={remove.isPending}
        onCancel={() => setToDelete(null)}
        onConfirm={() => toDelete && remove.mutate(toDelete.id)}
      />
    </>
  );
}
