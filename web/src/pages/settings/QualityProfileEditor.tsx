import { useMemo, useState, type FormEvent } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { QualityProfile, QualityProfileInput } from '@sonarr/shared';
import { ApiError } from '../../lib/api';
import { Button, FormField, Input, Modal, Select, Switch } from '../../components/ui';
import { errorMessage, useCreateQualityProfile, useUpdateQualityProfile } from './hooks';

type Item = QualityProfile['items'][number];

export interface QualityProfileEditorProps {
  /** Existing profile to edit, or a blank draft (id 0) from the schema endpoint to create one. */
  profile: QualityProfile;
  onClose: () => void;
  onSaved?: (profile: QualityProfile) => void;
}

/** Highest allowed quality. Items are stored lowest first, so it is the last allowed one. */
function highestAllowed(items: Item[]): number | undefined {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].allowed) return items[i].quality.id;
  return undefined;
}

/** Keep the cutoff on an allowed quality; falls back to the highest allowed one. */
function withValidCutoff(items: Item[], cutoff: number): number {
  if (items.some((i) => i.allowed && i.quality.id === cutoff)) return cutoff;
  return highestAllowed(items) ?? cutoff;
}

export function QualityProfileEditor({ profile, onClose, onSaved }: QualityProfileEditorProps) {
  const isNew = profile.id === 0;
  const [name, setName] = useState(profile.name);
  const [upgradeAllowed, setUpgradeAllowed] = useState(profile.upgradeAllowed);
  const [items, setItems] = useState<Item[]>(profile.items);
  const [cutoff, setCutoff] = useState(() => withValidCutoff(profile.items, profile.cutoff));
  const [submitted, setSubmitted] = useState(false);

  const create = useCreateQualityProfile({ onSuccess: onClose });
  const update = useUpdateQualityProfile({ onSuccess: onClose });
  const save = isNew ? create : update;

  const allowedCount = items.filter((i) => i.allowed).length;
  const nameError = submitted && !name.trim() ? 'Name is required' : undefined;
  const itemsError = submitted && allowedCount === 0 ? 'At least one quality must be allowed' : undefined;

  const serverError = save.error instanceof ApiError ? save.error : null;
  const serverName = serverError?.fieldError('name');
  const serverItems = serverError?.fieldError('items');
  const otherError =
    save.error && !serverName && !serverItems && !serverError?.fieldError('cutoff') ? errorMessage(save.error) : undefined;

  const cutoffOptions = useMemo(
    () => [...items].reverse().filter((i) => i.allowed).map((i) => ({ value: i.quality.id, label: i.quality.name })),
    [items],
  );

  const changeItems = (next: Item[]) => {
    setItems(next);
    setCutoff((c) => withValidCutoff(next, c));
  };

  const toggle = (qualityId: number, allowed: boolean) =>
    changeItems(items.map((i) => (i.quality.id === qualityId ? { ...i, allowed } : i)));

  /** direction +1 moves towards the highest quality (up the displayed list). */
  const move = (qualityId: number, direction: 1 | -1) => {
    const from = items.findIndex((i) => i.quality.id === qualityId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= items.length) return;
    const next = [...items];
    [next[from], next[to]] = [next[to], next[from]];
    changeItems(next);
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!name.trim() || allowedCount === 0) return;
    const body: QualityProfileInput = {
      ...(isNew ? {} : { id: profile.id }),
      name: name.trim(),
      upgradeAllowed,
      cutoff,
      items: items.map(({ quality, allowed }) => ({ quality, allowed })),
    };
    const done = (saved: QualityProfile) => onSaved?.(saved);
    if (isNew) create.mutate(body, { onSuccess: done });
    else update.mutate({ ...body, id: profile.id }, { onSuccess: done });
  };

  const displayed = [...items].reverse();

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Add quality profile' : `Edit ${profile.name}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="quality-profile-form" loading={save.isPending}>
            Save
          </Button>
        </>
      }
    >
      <form id="quality-profile-form" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        {otherError && (
          <p role="alert" className="text-sm font-medium text-danger">
            {otherError}
          </p>
        )}
        <FormField label="Name" required error={nameError ?? serverName}>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </FormField>
        <FormField label="Upgrades allowed" inline help="Upgrade existing files until the cutoff quality is reached.">
          <Switch checked={upgradeAllowed} onCheckedChange={setUpgradeAllowed} />
        </FormField>
        <FormField label="Upgrade until" help="Sonarr stops upgrading once this quality is downloaded.">
          <Select
            value={cutoff}
            disabled={cutoffOptions.length === 0}
            onChange={(e) => setCutoff(Number(e.target.value))}
            options={cutoffOptions}
          />
        </FormField>
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-text">Qualities</legend>
          <p className="text-xs text-text-muted">Highest quality first. Use the arrows to change the order.</p>
          {(itemsError ?? serverItems) && (
            <p role="alert" className="text-xs font-medium text-danger">
              {itemsError ?? serverItems}
            </p>
          )}
          <ul className="divide-y divide-border rounded-md border border-border">
            {displayed.map((item, index) => (
              <li key={item.quality.id} className="flex items-center gap-3 px-3 py-1.5">
                <input
                  type="checkbox"
                  id={`quality-allowed-${item.quality.id}`}
                  checked={item.allowed}
                  onChange={(e) => toggle(item.quality.id, e.target.checked)}
                  className="focus-ring size-4 accent-[var(--color-accent)]"
                />
                <label htmlFor={`quality-allowed-${item.quality.id}`} className="flex-1 cursor-pointer text-sm text-text">
                  {item.quality.name}
                </label>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${item.quality.name} up`}
                  disabled={index === 0}
                  onClick={() => move(item.quality.id, 1)}
                  icon={<ArrowUp />}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Move ${item.quality.name} down`}
                  disabled={index === displayed.length - 1}
                  onClick={() => move(item.quality.id, -1)}
                  icon={<ArrowDown />}
                />
              </li>
            ))}
          </ul>
        </fieldset>
      </form>
    </Modal>
  );
}
