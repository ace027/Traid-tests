import { useState } from 'react';
import { Save } from 'lucide-react';
import type { UiConfig } from '@sonarr/shared';
import { setTheme } from '../../lib/theme';
import { Button, Card, FormField, PageHeader, Select, Spinner, Switch, useToast, type SelectOption } from '../../components/ui';
import { errorMessage, useUiConfig, useUpdateUiConfig } from './hooks';

const opt = (value: string, label: string): SelectOption => ({ value, label });

const FIRST_DAY = [opt('0', 'Sunday'), opt('1', 'Monday')];
const WEEK_HEADERS = [opt('ddd M/D', 'Tue 3/25'), opt('ddd MM/DD', 'Tue 03/25'), opt('ddd D/M', 'Tue 25/3'), opt('ddd DD/MM', 'Tue 25/03')];
const SHORT_DATES = [
  opt('MMM D YYYY', 'Mar 25 2014'),
  opt('DD MMM YYYY', '25 Mar 2014'),
  opt('MM/D/YYYY', '03/25/2014'),
  opt('MM/DD/YYYY', '03/25/2014 (padded)'),
  opt('DD/MM/YYYY', '25/03/2014'),
  opt('YYYY-MM-DD', '2014-03-25'),
];
const LONG_DATES = [opt('dddd, MMMM D YYYY', 'Tuesday, March 25, 2014'), opt('dddd, D MMMM YYYY', 'Tuesday, 25 March 2014')];
const TIME_FORMATS = [opt('h(:mm)a', '5pm/5:30pm'), opt('HH:mm', '17:00/17:30')];
const THEMES = [opt('system', 'System'), opt('light', 'Light'), opt('dark', 'Dark')];

/** Keeps a stored value selectable even if it is not one of the standard options. */
const withCurrent = (options: SelectOption[], current: string) =>
  options.some((o) => o.value === current) ? options : [...options, opt(current, current)];

function UiForm({ config }: { config: UiConfig }) {
  const toast = useToast();
  const [draft, setDraft] = useState<UiConfig>(config);
  const save = useUpdateUiConfig({ onSuccess: () => toast.success('UI settings saved') });
  const dirty = JSON.stringify(draft) !== JSON.stringify(config);

  const set = <K extends keyof UiConfig>(key: K, value: UiConfig[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (dirty) save.mutate(draft);
      }}
    >
      <Card title="Calendar">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="First day of week">
            <Select value={String(draft.firstDayOfWeek)} onChange={(e) => set('firstDayOfWeek', e.target.value === '1' ? 1 : 0)} options={FIRST_DAY} />
          </FormField>
          <FormField label="Week column header">
            <Select
              value={draft.calendarWeekColumnHeader}
              onChange={(e) => set('calendarWeekColumnHeader', e.target.value)}
              options={withCurrent(WEEK_HEADERS, draft.calendarWeekColumnHeader)}
            />
          </FormField>
        </div>
      </Card>

      <Card title="Dates">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Short date format">
            <Select value={draft.shortDateFormat} onChange={(e) => set('shortDateFormat', e.target.value)} options={withCurrent(SHORT_DATES, draft.shortDateFormat)} />
          </FormField>
          <FormField label="Long date format">
            <Select value={draft.longDateFormat} onChange={(e) => set('longDateFormat', e.target.value)} options={withCurrent(LONG_DATES, draft.longDateFormat)} />
          </FormField>
          <FormField label="Time format">
            <Select value={draft.timeFormat} onChange={(e) => set('timeFormat', e.target.value)} options={withCurrent(TIME_FORMATS, draft.timeFormat)} />
          </FormField>
        </div>
        <FormField className="mt-4" inline label="Show relative dates" help="Show Today, Yesterday or Tomorrow instead of the date.">
          <Switch checked={draft.showRelativeDates} onCheckedChange={(v) => set('showRelativeDates', v)} />
        </FormField>
      </Card>

      <Card title="Style">
        <div className="flex flex-col gap-4">
          <FormField label="Theme" className="max-w-xs">
            <Select
              value={draft.theme}
              onChange={(e) => {
                const theme = e.target.value as UiConfig['theme'];
                set('theme', theme);
                setTheme(theme); // preview straight away; Save persists it on the server
              }}
              options={THEMES}
            />
          </FormField>
          <FormField inline label="Color-impaired mode" help="Adds patterns and labels so status never relies on colour alone.">
            <Switch checked={draft.enableColorImpairedMode} onCheckedChange={(v) => set('enableColorImpairedMode', v)} />
          </FormField>
        </div>
      </Card>

      <div className="flex items-center justify-end gap-3">
        {save.error != null && (
          <p role="alert" className="mr-auto text-sm font-medium text-danger">
            {errorMessage(save.error)}
          </p>
        )}
        <Button type="submit" variant="primary" icon={<Save />} loading={save.isPending} disabled={!dirty}>
          Save
        </Button>
      </div>
    </form>
  );
}

export function UiSettings() {
  const config = useUiConfig();
  return (
    <>
      <PageHeader title="UI" description="Calendar, date formats and appearance." />
      {config.isPending ? (
        <Spinner label="Loading settings" />
      ) : config.isError ? (
        <p role="alert" className="text-sm text-danger">
          {errorMessage(config.error)}
        </p>
      ) : (
        <UiForm config={config.data} />
      )}
    </>
  );
}
