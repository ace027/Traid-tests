import { useState } from 'react';
import { Save } from 'lucide-react';
import type { QualityDefinition } from '@sonarr/shared';
import { Button, Card, Input, PageHeader, Spinner, Table, TBody, Td, Th, THead, Tr, useToast } from '../../components/ui';
import { errorMessage, useQualityDefinitions, useUpdateQualityDefinitions } from './hooks';

const MAX_SIZE = 1000;

interface Draft {
  title: string;
  minSize: string;
  preferredSize: string;
  maxSize: string;
}

interface RowErrors {
  title?: string;
  minSize?: string;
  preferredSize?: string;
  maxSize?: string;
}

const toText = (n: number | null) => (n === null ? '' : String(n));
const toDraft = (d: QualityDefinition): Draft => ({
  title: d.title,
  minSize: toText(d.minSize),
  preferredSize: toText(d.preferredSize),
  maxSize: toText(d.maxSize),
});

/** Parses a size field; empty means "no limit" for preferred and max. */
function parseSize(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

function validateDraft(draft: Draft): RowErrors {
  const errors: RowErrors = {};
  if (!draft.title.trim()) errors.title = 'Title is required';
  const min = parseSize(draft.minSize);
  const preferred = parseSize(draft.preferredSize);
  const max = parseSize(draft.maxSize);
  const range = (v: number | null | undefined, key: 'minSize' | 'preferredSize' | 'maxSize') => {
    if (v === undefined) errors[key] = 'Must be a number';
    else if (v !== null && (v < 0 || v > MAX_SIZE)) errors[key] = `Must be between 0 and ${MAX_SIZE}`;
  };
  range(min, 'minSize');
  range(preferred, 'preferredSize');
  range(max, 'maxSize');
  if (draft.minSize.trim() === '') errors.minSize ??= 'Min size is required';
  if (!errors.minSize && !errors.maxSize && min !== null && min !== undefined && max !== null && max !== undefined && min > max) {
    errors.minSize = 'Min size cannot be greater than max size';
  }
  if (!errors.preferredSize && preferred !== null && preferred !== undefined) {
    if (min !== null && min !== undefined && !errors.minSize && preferred < min) {
      errors.preferredSize = 'Preferred size cannot be less than min size';
    } else if (max !== null && max !== undefined && !errors.maxSize && preferred > max) {
      errors.preferredSize = 'Preferred size cannot be greater than max size';
    }
  }
  return errors;
}

function DefinitionsTable({ definitions }: { definitions: QualityDefinition[] }) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<Record<number, Draft>>(() =>
    Object.fromEntries(definitions.map((d) => [d.id, toDraft(d)])),
  );
  const save = useUpdateQualityDefinitions({ onSuccess: () => toast.success('Quality definitions saved') });

  const errors = Object.fromEntries(definitions.map((d) => [d.id, validateDraft(drafts[d.id])]));
  const hasErrors = Object.values(errors).some((e) => Object.keys(e).length > 0);
  const dirty = definitions.some((d) => {
    const a = toDraft(d);
    const b = drafts[d.id];
    return a.title !== b.title || a.minSize !== b.minSize || a.preferredSize !== b.preferredSize || a.maxSize !== b.maxSize;
  });

  const setField = (id: number, field: keyof Draft, value: string) =>
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));

  const onSave = () => {
    save.mutate(
      definitions.map((d) => {
        const draft = drafts[d.id];
        return {
          ...d,
          title: draft.title.trim(),
          minSize: parseSize(draft.minSize) ?? 0,
          preferredSize: parseSize(draft.preferredSize) ?? null,
          maxSize: parseSize(draft.maxSize) ?? null,
        };
      }),
    );
  };

  const sizeCell = (d: QualityDefinition, field: 'minSize' | 'preferredSize' | 'maxSize', label: string, placeholder?: string) => {
    const error = errors[d.id][field];
    const errorId = `def-${d.id}-${field}-error`;
    return (
      <Td className="align-top">
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          max={MAX_SIZE}
          step="any"
          className="w-28"
          aria-label={`${label} for ${d.quality.name}`}
          aria-describedby={error ? errorId : undefined}
          invalid={!!error}
          placeholder={placeholder}
          value={drafts[d.id][field]}
          onChange={(e) => setField(d.id, field, e.target.value)}
        />
        {error && (
          <p id={errorId} className="mt-1 max-w-40 text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </Td>
    );
  };

  return (
    <Card
      title="Quality definitions"
      description="Size limits in MB per minute of runtime. Leave maximum empty for no limit."
      flush
      footer={
        <>
          {save.error != null && (
            <p role="alert" className="mr-auto self-center text-sm font-medium text-danger">
              {errorMessage(save.error)}
            </p>
          )}
          <Button variant="primary" icon={<Save />} loading={save.isPending} disabled={!dirty || hasErrors} onClick={onSave}>
            Save
          </Button>
        </>
      }
    >
      <Table caption="Quality definitions" captionHidden>
        <THead>
          <Tr>
            <Th>Quality</Th>
            <Th>Title</Th>
            <Th>Min (MB/min)</Th>
            <Th>Preferred (MB/min)</Th>
            <Th>Max (MB/min)</Th>
          </Tr>
        </THead>
        <TBody>
          {definitions.map((d) => (
            <Tr key={d.id}>
              <Td className="align-top font-medium">{d.quality.name}</Td>
              <Td className="align-top">
                <Input
                  aria-label={`Title for ${d.quality.name}`}
                  aria-describedby={errors[d.id].title ? `def-${d.id}-title-error` : undefined}
                  invalid={!!errors[d.id].title}
                  value={drafts[d.id].title}
                  onChange={(e) => setField(d.id, 'title', e.target.value)}
                />
                {errors[d.id].title && (
                  <p id={`def-${d.id}-title-error`} className="mt-1 text-xs font-medium text-danger">
                    {errors[d.id].title}
                  </p>
                )}
              </Td>
              {sizeCell(d, 'minSize', 'Min size')}
              {sizeCell(d, 'preferredSize', 'Preferred size', 'None')}
              {sizeCell(d, 'maxSize', 'Max size', 'Unlimited')}
            </Tr>
          ))}
        </TBody>
      </Table>
    </Card>
  );
}

export function Quality() {
  const definitions = useQualityDefinitions();
  return (
    <>
      <PageHeader title="Quality" description="Set the minimum, preferred and maximum file size for each quality." />
      {definitions.isPending ? (
        <Spinner label="Loading quality definitions" />
      ) : definitions.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(definitions.error)}
        </p>
      ) : (
        <DefinitionsTable definitions={definitions.data} />
      )}
    </>
  );
}
