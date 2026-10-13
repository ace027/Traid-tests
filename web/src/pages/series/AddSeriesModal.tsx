import { useEffect, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check } from 'lucide-react';
import { monitorOptions, type MonitorOption, type SeriesLookup, type SeriesType, type Tag } from '@sonarr/shared';
import { Button, FormField, Modal, Select, Switch, useToast } from '../../components/ui';
import { cn } from '../../lib/cn';
import {
  errorMessage,
  formatBytes,
  monitorOptionLabels,
  seriesTypeLabels,
  useAddSeries,
  useQualityProfiles,
  useRootFolders,
  useTags,
} from './hooks';
import { PosterImage } from './SeriesPoster';

export const monitorSelectOptions = monitorOptions.map((value) => ({ value, label: monitorOptionLabels[value] }));
export const seriesTypeSelectOptions = (Object.keys(seriesTypeLabels) as SeriesType[]).map((value) => ({
  value,
  label: seriesTypeLabels[value],
}));

/** Multi-select of tags rendered as toggle chips (aria-pressed). */
export function TagPicker({
  tags,
  value,
  onChange,
  label = 'Tags',
}: {
  tags: Tag[];
  value: number[];
  onChange: (ids: number[]) => void;
  label?: string;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={labelId} className="text-sm font-medium text-text">
        {label}
      </span>
      {tags.length === 0 ? (
        <p className="text-xs text-text-muted">
          No tags yet. Create them in{' '}
          <Link to="/settings/tags" className="text-accent underline-offset-2 hover:underline">
            Settings / Tags
          </Link>
          .
        </p>
      ) : (
        <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-1.5">
          {tags.map((tag) => {
            const on = value.includes(tag.id);
            return (
              <button
                key={tag.id}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(on ? value.filter((id) => id !== tag.id) : [...value, tag.id])}
                className={cn(
                  'focus-ring inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                  on
                    ? 'border-accent/40 bg-accent-soft text-accent'
                    : 'border-border bg-surface text-text-muted hover:border-border-strong hover:text-text',
                )}
              >
                {on && <Check aria-hidden="true" className="size-3" />}
                {tag.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export interface AddSeriesModalProps {
  series: SeriesLookup | null;
  onClose: () => void;
}

function Checkbox({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-text">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="focus-ring size-4 rounded border-control-border accent-accent"
      />
      {label}
    </label>
  );
}

function AddSeriesForm({ series, onClose }: { series: SeriesLookup; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const rootFolders = useRootFolders();
  const profiles = useQualityProfiles();
  const tags = useTags();

  const [rootFolderPath, setRootFolderPath] = useState('');
  const [monitor, setMonitor] = useState<MonitorOption>('all');
  const [qualityProfileId, setQualityProfileId] = useState(0);
  const [seriesType, setSeriesType] = useState<SeriesType>(series.seriesType ?? 'standard');
  const [seasonFolder, setSeasonFolder] = useState(true);
  const [tagIds, setTagIds] = useState<number[]>([]);
  const [searchMissing, setSearchMissing] = useState(false);
  const [searchCutoff, setSearchCutoff] = useState(false);

  // Default to the first root folder / profile once they load.
  useEffect(() => {
    if (!rootFolderPath && rootFolders.data?.[0]) setRootFolderPath(rootFolders.data[0].path);
  }, [rootFolders.data, rootFolderPath]);
  useEffect(() => {
    if (!qualityProfileId && profiles.data?.[0]) setQualityProfileId(profiles.data[0].id);
  }, [profiles.data, qualityProfileId]);

  const add = useAddSeries({
    onSuccess: (created) => {
      toast.success(`Added ${created.title}`);
      onClose();
      navigate(`/series/${created.titleSlug}`);
    },
  });

  const loading = rootFolders.isPending || profiles.isPending;
  const missingSetup = !loading && (!rootFolders.data?.length || !profiles.data?.length);

  if (missingSetup) {
    return (
      <div className="flex flex-col gap-3 text-sm text-text-muted">
        <p>Before adding series you need at least one root folder and one quality profile.</p>
        <div className="flex flex-wrap gap-2">
          {!rootFolders.data?.length && (
            <Link to="/settings/mediamanagement" className="text-accent underline-offset-2 hover:underline">
              Add a root folder
            </Link>
          )}
          {!profiles.data?.length && (
            <Link to="/settings/profiles" className="text-accent underline-offset-2 hover:underline">
              Add a quality profile
            </Link>
          )}
        </div>
      </div>
    );
  }

  const submit = () => {
    if (!rootFolderPath || !qualityProfileId) return;
    add.mutate({
      tvMazeId: series.tvMazeId,
      tvdbId: series.tvdbId > 0 ? series.tvdbId : null,
      title: series.title,
      qualityProfileId,
      rootFolderPath,
      seriesType,
      seasonFolder,
      monitored: monitor !== 'none',
      monitorNewItems: 'all',
      tags: tagIds,
      addOptions: {
        monitor,
        searchForMissingEpisodes: searchMissing,
        searchForCutoffUnmetEpisodes: searchCutoff,
      },
    });
  };

  return (
    <form
      id="add-series-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-5"
    >
      <div className="flex gap-4">
        <div className="w-20 shrink-0 sm:w-24">
          <PosterImage series={series} />
        </div>
        <p className="line-clamp-5 text-sm text-text-muted">{series.overview || 'No overview available.'}</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Root Folder" className="sm:col-span-2">
          <Select value={rootFolderPath} onChange={(e) => setRootFolderPath(e.target.value)}>
            {rootFolders.data?.map((f) => (
              <option key={f.id} value={f.path}>
                {f.path} ({formatBytes(f.freeSpace)} free)
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Monitor">
          <Select value={monitor} onChange={(e) => setMonitor(e.target.value as MonitorOption)} options={monitorSelectOptions} />
        </FormField>
        <FormField label="Quality Profile">
          <Select value={qualityProfileId} onChange={(e) => setQualityProfileId(Number(e.target.value))}>
            {profiles.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </FormField>
        <FormField label="Series Type">
          <Select
            value={seriesType}
            onChange={(e) => setSeriesType(e.target.value as SeriesType)}
            options={seriesTypeSelectOptions}
          />
        </FormField>
        <FormField label="Season Folder" inline className="sm:pt-6">
          <Switch checked={seasonFolder} onCheckedChange={setSeasonFolder} />
        </FormField>
      </div>
      <TagPicker tags={tags.data ?? []} value={tagIds} onChange={setTagIds} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium text-text">After adding</legend>
        <Checkbox checked={searchMissing} onChange={setSearchMissing} label="Start search for missing episodes" />
        <Checkbox checked={searchCutoff} onChange={setSearchCutoff} label="Start search for cutoff unmet episodes" />
      </fieldset>
      {add.isError && (
        <p role="alert" className="text-sm font-medium text-danger">
          {errorMessage(add.error)}
        </p>
      )}
      <div className="-mx-5 -mb-5 flex justify-end gap-2 rounded-b-xl border-t border-border bg-surface px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={add.isPending} disabled={!rootFolderPath || !qualityProfileId}>
          Add {series.title}
        </Button>
      </div>
    </form>
  );
}

/** Options for adding a looked-up series: root folder, monitoring, profile, type, tags and searches. */
export function AddSeriesModal({ series, onClose }: AddSeriesModalProps) {
  return (
    <Modal
      open={series !== null}
      onClose={onClose}
      title={series ? `${series.title}${series.year ? ` (${series.year})` : ''}` : 'Add series'}
      size="lg"
    >
      {series && <AddSeriesForm series={series} onClose={onClose} />}
    </Modal>
  );
}
