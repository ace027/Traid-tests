import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueries, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { FolderCheck, FolderInput, Settings } from 'lucide-react';
import type { AddSeriesInput, MonitorOption, QualityProfile, Series, SeriesLookup, SeriesType } from '@sonarr/shared';
import {
  Button,
  EmptyState,
  FormField,
  PageHeader,
  Select,
  Spinner,
  TBody,
  THead,
  Table,
  Td,
  Th,
  Tr,
  buttonClasses,
  useToast,
} from '../../components/ui';
import { api, queryKeys } from '../../lib/api';
import { monitorSelectOptions, seriesTypeSelectOptions } from './AddSeriesModal';
import {
  errorMessage,
  folderLookupTerm,
  formatBytes,
  useQualityProfiles,
  useRootFolder,
  seriesLookupQuery,
  useRootFolders,
} from './hooks';

interface RowState {
  selected: boolean;
  /** Chosen match; undefined means the best (first) lookup result. */
  tvMazeId?: number;
  monitor: MonitorOption;
  qualityProfileId?: number;
  seriesType?: SeriesType;
}

const defaultRow = (): RowState => ({ selected: false, monitor: 'all' });

interface Folder {
  name: string;
  path: string;
}

function ImportRow({
  folder,
  state,
  profiles,
  lookup,
  onChange,
}: {
  folder: Folder;
  state: RowState;
  profiles: QualityProfile[];
  lookup: UseQueryResult<SeriesLookup[]>;
  onChange: (patch: Partial<RowState>) => void;
}) {
  const results = lookup.data ?? [];
  const match = results.find((r) => r.tvMazeId === state.tvMazeId) ?? results[0];
  const label = (what: string) => `${what} for ${folder.name}`;

  return (
    <Tr>
      <Td className="w-10">
        <input
          type="checkbox"
          aria-label={`Select ${folder.name}`}
          checked={state.selected}
          disabled={!match}
          onChange={(e) => onChange({ selected: e.target.checked })}
          className="focus-ring size-4 accent-accent"
        />
      </Td>
      <Td>
        <div className="font-medium">{folder.name}</div>
        <div className="max-w-xs truncate text-xs text-text-muted" title={folder.path}>
          {folder.path}
        </div>
      </Td>
      <Td className="min-w-56">
        {lookup.isPending && folderLookupTerm(folder.name).length >= 2 ? (
          <Spinner size="sm" label={`Looking up ${folder.name}`} />
        ) : lookup.isError ? (
          <span className="text-sm text-danger">{errorMessage(lookup.error)}</span>
        ) : results.length === 0 ? (
          <span className="text-sm text-text-muted">No match found</span>
        ) : (
          <Select
            aria-label={label('Series')}
            value={match?.tvMazeId}
            onChange={(e) => onChange({ tvMazeId: Number(e.target.value) })}
          >
            {results.map((r) => (
              <option key={r.tvMazeId} value={r.tvMazeId}>
                {r.title}
                {r.year ? ` (${r.year})` : ''}
                {r.network ? ` - ${r.network}` : ''}
              </option>
            ))}
          </Select>
        )}
      </Td>
      <Td className="min-w-40">
        <Select
          aria-label={label('Monitor')}
          value={state.monitor}
          onChange={(e) => onChange({ monitor: e.target.value as MonitorOption })}
          options={monitorSelectOptions}
        />
      </Td>
      <Td className="min-w-36">
        <Select
          aria-label={label('Quality Profile')}
          value={state.qualityProfileId ?? profiles[0]?.id}
          onChange={(e) => onChange({ qualityProfileId: Number(e.target.value) })}
          options={profiles.map((p) => ({ value: p.id, label: p.name }))}
        />
      </Td>
      <Td className="min-w-32">
        <Select
          aria-label={label('Series Type')}
          value={state.seriesType ?? match?.seriesType ?? 'standard'}
          onChange={(e) => onChange({ seriesType: e.target.value as SeriesType })}
          options={seriesTypeSelectOptions}
        />
      </Td>
    </Tr>
  );
}

/** Map existing folders in a root folder to series and add them with their current path. */
export function LibraryImport() {
  const qc = useQueryClient();
  const toast = useToast();
  const rootFolders = useRootFolders();
  const profiles = useQualityProfiles();
  const [rootId, setRootId] = useState<number | undefined>(undefined);
  const root = useRootFolder(rootId);
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (rootId === undefined && rootFolders.data?.[0]) setRootId(rootFolders.data[0].id);
  }, [rootFolders.data, rootId]);

  const folders: Folder[] = useMemo(() => root.data?.unmappedFolders ?? [], [root.data]);
  const rowState = (path: string) => rows[path] ?? defaultRow();
  const patchRow = (path: string, patch: Partial<RowState>) =>
    setRows((prev) => ({ ...prev, [path]: { ...(prev[path] ?? defaultRow()), ...patch } }));

  // Each folder name is looked up once; rows render from the same queries.
  const lookups = useQueries({ queries: folders.map((f) => seriesLookupQuery(folderLookupTerm(f.name))) });
  const lookupFor = (folder: Folder) => lookups[folders.indexOf(folder)]?.data ?? [];
  const matchable = folders.filter((f) => lookupFor(f).length > 0);
  const selected = folders.filter((f) => rowState(f.path).selected);
  const allSelected = matchable.length > 0 && matchable.every((f) => rowState(f.path).selected);

  const importSelected = async () => {
    const profileList = profiles.data ?? [];
    setImporting(true);
    let added = 0;
    const failures: string[] = [];
    for (const folder of selected) {
      const state = rowState(folder.path);
      const results = lookupFor(folder);
      const match = results.find((r) => r.tvMazeId === state.tvMazeId) ?? results[0];
      const qualityProfileId = state.qualityProfileId ?? profileList[0]?.id;
      if (!match || !qualityProfileId) {
        failures.push(`${folder.name}: no match`);
        continue;
      }
      const body: AddSeriesInput = {
        tvMazeId: match.tvMazeId,
        tvdbId: match.tvdbId > 0 ? match.tvdbId : null,
        title: match.title,
        qualityProfileId,
        path: folder.path,
        seriesType: state.seriesType ?? match.seriesType ?? 'standard',
        seasonFolder: true,
        monitored: state.monitor !== 'none',
        monitorNewItems: 'all',
        tags: [],
        addOptions: { monitor: state.monitor, searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false },
      };
      try {
        await api.post<Series>('series', body);
        added++;
        setRows((prev) => {
          const next = { ...prev };
          delete next[folder.path];
          return next;
        });
      } catch (e) {
        failures.push(`${folder.name}: ${errorMessage(e)}`);
      }
    }
    setImporting(false);
    await Promise.all([
      qc.invalidateQueries({ queryKey: queryKeys.series }),
      qc.invalidateQueries({ queryKey: queryKeys.rootFolders }),
    ]);
    if (added > 0) toast.success(`Imported ${added} series`);
    for (const f of failures) toast.error(f);
  };

  const noRoots = rootFolders.isSuccess && rootFolders.data.length === 0;
  const noProfiles = profiles.isSuccess && profiles.data.length === 0;

  return (
    <div>
      <PageHeader
        title="Library Import"
        description="Import series you already have on disk. Folders are matched by name; files are scanned after import."
        actions={
          <Button
            variant="primary"
            icon={<FolderInput aria-hidden="true" />}
            disabled={selected.length === 0 || importing}
            loading={importing}
            onClick={() => void importSelected()}
          >
            Import {selected.length} series
          </Button>
        }
      />

      {rootFolders.isPending || profiles.isPending ? (
        <Spinner label="Loading root folders" />
      ) : noRoots || noProfiles ? (
        <EmptyState
          icon={<Settings />}
          title={noRoots ? 'No root folders configured' : 'No quality profiles configured'}
          description="Library Import needs a root folder to scan and a quality profile to assign."
          action={
            <Link to={noRoots ? '/settings/mediamanagement' : '/settings/profiles'} className={buttonClasses('primary')}>
              {noRoots ? 'Add a root folder' : 'Add a quality profile'}
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          <FormField label="Root Folder" className="max-w-md">
            <Select
              value={rootId ?? ''}
              onChange={(e) => {
                setRootId(Number(e.target.value));
                setRows({});
              }}
            >
              {rootFolders.data?.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.path} ({formatBytes(f.freeSpace)} free)
                </option>
              ))}
            </Select>
          </FormField>

          {root.isPending ? (
            <Spinner label="Loading folders" />
          ) : root.isError ? (
            <p role="alert" className="text-sm text-danger">
              {errorMessage(root.error)}
            </p>
          ) : folders.length === 0 ? (
            <EmptyState
              icon={<FolderCheck />}
              title="Nothing to import"
              description="Every folder in this root folder is already in your library."
            />
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-sm">
              <Table caption={`Unmapped folders in ${root.data?.path ?? ''}`} captionHidden>
                <THead>
                  <tr>
                    <Th className="w-10">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={allSelected}
                        disabled={matchable.length === 0}
                        onChange={(e) => {
                          for (const f of matchable) patchRow(f.path, { selected: e.target.checked });
                        }}
                        className="focus-ring size-4 accent-accent"
                      />
                    </Th>
                    <Th>Folder</Th>
                    <Th>Series</Th>
                    <Th>Monitor</Th>
                    <Th>Quality Profile</Th>
                    <Th>Series Type</Th>
                  </tr>
                </THead>
                <TBody>
                  {folders.map((folder, i) => (
                    <ImportRow
                      key={folder.path}
                      folder={folder}
                      lookup={lookups[i]}
                      state={rowState(folder.path)}
                      profiles={profiles.data ?? []}
                      onChange={(patch) => patchRow(folder.path, patch)}
                    />
                  ))}
                </TBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
