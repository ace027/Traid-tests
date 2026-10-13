import { useState } from 'react';
import type { MonitorNewItems, Series, SeriesType } from '@sonarr/shared';
import { Button, FormField, Input, Modal, Select, Switch, useToast } from '../../components/ui';
import { ApiError } from '../../lib/api';
import { TagPicker, seriesTypeSelectOptions } from './AddSeriesModal';
import { errorMessage, useQualityProfiles, useTags, useUpdateSeries } from './hooks';

export interface EditSeriesModalProps {
  series: Series;
  open: boolean;
  onClose: () => void;
}

function EditForm({ series, onClose }: { series: Series; onClose: () => void }) {
  const toast = useToast();
  const profiles = useQualityProfiles();
  const tags = useTags();
  const [monitored, setMonitored] = useState(series.monitored);
  const [monitorNewItems, setMonitorNewItems] = useState<MonitorNewItems>(series.monitorNewItems);
  const [qualityProfileId, setQualityProfileId] = useState(series.qualityProfileId);
  const [seriesType, setSeriesType] = useState<SeriesType>(series.seriesType);
  const [seasonFolder, setSeasonFolder] = useState(series.seasonFolder);
  const [path, setPath] = useState(series.path);
  const [tagIds, setTagIds] = useState<number[]>(series.tags);

  const update = useUpdateSeries({
    inline: true,
    onSuccess: () => {
      toast.success(`Saved ${series.title}`);
      onClose();
    },
  });
  const pathError = update.error instanceof ApiError ? update.error.fieldError('path') : undefined;

  return (
    <form
      id="edit-series-form"
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        update.mutate({
          id: series.id,
          monitored,
          monitorNewItems,
          qualityProfileId,
          seriesType,
          seasonFolder,
          path: path.trim(),
          tags: tagIds,
        });
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Monitored" inline help="Download monitored episodes in this series">
          <Switch checked={monitored} onCheckedChange={setMonitored} />
        </FormField>
        <FormField label="Season Folder" inline help="Sort episodes into season folders">
          <Switch checked={seasonFolder} onCheckedChange={setSeasonFolder} />
        </FormField>
        <FormField label="Monitor New Seasons">
          <Select
            value={monitorNewItems}
            onChange={(e) => setMonitorNewItems(e.target.value as MonitorNewItems)}
            options={[
              { value: 'all', label: 'All Seasons' },
              { value: 'none', label: 'None' },
            ]}
          />
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
        <FormField label="Path" error={pathError} required className="sm:col-span-2">
          <Input value={path} onChange={(e) => setPath(e.target.value)} spellCheck={false} />
        </FormField>
      </div>
      <TagPicker tags={tags.data ?? []} value={tagIds} onChange={setTagIds} />
      {update.isError && !pathError && (
        <p role="alert" className="text-sm font-medium text-danger">
          {errorMessage(update.error)}
        </p>
      )}
      <div className="-mx-5 -mb-5 flex justify-end gap-2 rounded-b-xl border-t border-border bg-surface px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={update.isPending} disabled={!path.trim()}>
          Save
        </Button>
      </div>
    </form>
  );
}

/** Edit monitoring, profile, type, season folder, path and tags of a series. */
export function EditSeriesModal({ series, open, onClose }: EditSeriesModalProps) {
  return (
    <Modal open={open} onClose={onClose} title={`Edit ${series.title}`} size="lg">
      {open && <EditForm series={series} onClose={onClose} />}
    </Modal>
  );
}
