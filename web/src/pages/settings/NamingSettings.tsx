import { useId, useRef, useState } from 'react';
import { colonReplacementFormats, multiEpisodeStyles, type NamingConfig } from '@sonarr/shared';
import { ApiError } from '../../lib/api';
import { Button, FormField, Input, Select, Switch } from '../../components/ui';
import { useNamingExamples } from './mediaHooks';

const seriesTokens = ['{Series Title}', '{Series TitleYear}', '{Series CleanTitle}', '{Series TitleThe}'];
const episodeTokens = [
  ...seriesTokens,
  '{season:00}',
  '{episode:00}',
  '{absolute:000}',
  '{Air-Date}',
  '{Episode Title}',
  '{Episode CleanTitle}',
  '{Quality Full}',
  '{Quality Title}',
  '{Release Group}',
  '{Original Title}',
  '{Original Filename}',
];
const folderTokens = ['{Series Title}', '{Series TitleYear}', '{Series CleanTitle}', '{Series TitleThe}'];
const seasonTokens = ['{season}', '{season:00}'];

const colonLabels: Record<(typeof colonReplacementFormats)[number], string> = {
  delete: 'Delete',
  dash: 'Replace with dash',
  spaceDash: 'Replace with space dash',
  spaceDashSpace: 'Replace with space dash space',
  smart: 'Smart replace',
};
const styleLabels: Record<(typeof multiEpisodeStyles)[number], string> = {
  extend: 'Extend',
  duplicate: 'Duplicate',
  repeat: 'Repeat',
  scene: 'Scene',
  range: 'Range',
  prefixedRange: 'Prefixed range',
};

type FormatKey = 'standardEpisodeFormat' | 'dailyEpisodeFormat' | 'animeEpisodeFormat' | 'seriesFolderFormat' | 'seasonFolderFormat' | 'specialsFolderFormat';

function FormatField({
  label,
  value,
  tokens,
  error,
  onChange,
}: {
  label: string;
  value: string;
  tokens: string[];
  error?: string;
  onChange: (v: string) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const popoverId = useId();

  const insert = (token: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    onChange(value.slice(0, start) + token + value.slice(end));
    const caret = start + token.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(caret, caret);
    });
  };

  return (
    <div
      className="flex flex-col gap-1.5"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <FormField label={label} error={error}>
        <Input ref={ref} value={value} onChange={(e) => onChange(e.target.value)} className="font-mono" autoComplete="off" spellCheck={false} />
      </FormField>
      {tokens.length > 0 && (
      <div className="relative">
        <Button size="sm" variant="ghost" aria-label={`Tokens for ${label}`} aria-expanded={open} aria-controls={popoverId} onClick={() => setOpen((o) => !o)}>
          Tokens
        </Button>
        {open && (
          <div
            id={popoverId}
            role="group"
            aria-label={`Tokens for ${label}`}
            className="absolute left-0 z-20 mt-1 flex max-h-64 w-80 max-w-[80vw] flex-wrap gap-1 overflow-auto rounded-lg border border-border bg-surface-raised p-2 shadow-lg"
          >
            {tokens.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => insert(t)}
                className="focus-ring rounded border border-border px-1.5 py-0.5 font-mono text-xs text-text hover:bg-surface-hover"
              >
                {t}
              </button>
            ))}
          </div>
        )}
      </div>
      )}
    </div>
  );
}

export interface NamingSettingsProps {
  value: NamingConfig;
  onChange: (patch: Partial<NamingConfig>) => void;
  /** Error from saving; validation errors are shown on the matching field. */
  saveError?: unknown;
}

export function NamingSettings({ value, onChange, saveError }: NamingSettingsProps) {
  const examples = useNamingExamples(value);
  const fieldError = (key: FormatKey) => {
    if (saveError instanceof ApiError) return saveError.fieldError(key);
    return undefined;
  };
  const exampleError = examples.error instanceof ApiError ? examples.error : null;
  const errorFor = (key: FormatKey) => fieldError(key) ?? exampleError?.fieldError(key);

  const switchRow = (label: string, key: 'renameEpisodes' | 'replaceIllegalCharacters', help: string) => (
    <FormField label={label} help={help} inline>
      <Switch checked={value[key]} onCheckedChange={(v) => onChange({ [key]: v })} />
    </FormField>
  );

  const preview: [string, string | undefined][] = [
    ['Single episode', examples.data?.singleEpisodeExample],
    ['Multi episode', examples.data?.multiEpisodeExample],
    ['Daily episode', examples.data?.dailyEpisodeExample],
    ['Anime episode', examples.data?.animeEpisodeExample],
    ['Series folder', examples.data?.seriesFolderExample],
    ['Season folder', examples.data?.seasonFolderExample],
    ['Specials folder', examples.data?.specialsFolderExample],
  ];

  return (
    <div className="flex flex-col gap-5">
      {switchRow('Rename episodes', 'renameEpisodes', 'When off, imported files keep their original name.')}
      {switchRow('Replace illegal characters', 'replaceIllegalCharacters', 'Replace characters that are not allowed in file names.')}
      <FormField label="Colon replacement">
        <Select
          value={value.colonReplacementFormat}
          onChange={(e) => onChange({ colonReplacementFormat: e.target.value as NamingConfig['colonReplacementFormat'] })}
          options={colonReplacementFormats.map((v) => ({ value: v, label: colonLabels[v] }))}
        />
      </FormField>
      <FormField label="Multi-episode style">
        <Select
          value={value.multiEpisodeStyle}
          onChange={(e) => onChange({ multiEpisodeStyle: e.target.value as NamingConfig['multiEpisodeStyle'] })}
          options={multiEpisodeStyles.map((v) => ({ value: v, label: styleLabels[v] }))}
        />
      </FormField>
      <div className="grid gap-4 lg:grid-cols-2">
        <FormatField label="Standard episode format" value={value.standardEpisodeFormat} tokens={episodeTokens} error={errorFor('standardEpisodeFormat')} onChange={(v) => onChange({ standardEpisodeFormat: v })} />
        <FormatField label="Daily episode format" value={value.dailyEpisodeFormat} tokens={episodeTokens} error={errorFor('dailyEpisodeFormat')} onChange={(v) => onChange({ dailyEpisodeFormat: v })} />
        <FormatField label="Anime episode format" value={value.animeEpisodeFormat} tokens={episodeTokens} error={errorFor('animeEpisodeFormat')} onChange={(v) => onChange({ animeEpisodeFormat: v })} />
        <FormatField label="Series folder format" value={value.seriesFolderFormat} tokens={folderTokens} error={errorFor('seriesFolderFormat')} onChange={(v) => onChange({ seriesFolderFormat: v })} />
        <FormatField label="Season folder format" value={value.seasonFolderFormat} tokens={seasonTokens} error={errorFor('seasonFolderFormat')} onChange={(v) => onChange({ seasonFolderFormat: v })} />
        <FormatField label="Specials folder format" value={value.specialsFolderFormat} tokens={[]} error={errorFor('specialsFolderFormat')} onChange={(v) => onChange({ specialsFolderFormat: v })} />
      </div>
      <section aria-label="Naming preview" className="rounded-lg border border-border bg-surface-sunken p-4">
        <h3 className="mb-2 text-sm font-semibold text-text">Preview</h3>
        {examples.isPending ? (
          <p role="status" className="text-sm text-text-muted">
            Loading preview
          </p>
        ) : (
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[10rem_1fr]">
            {preview.map(([label, text]) => (
              <div key={label} className="contents">
                <dt className="text-xs text-text-muted">{label}</dt>
                <dd className="font-mono text-xs break-all text-text">{text ?? '-'}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </div>
  );
}
