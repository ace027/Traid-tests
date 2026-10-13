import { useEffect, useState } from 'react';
import { Copy, Rss, TriangleAlert } from 'lucide-react';
import { Button, FormField, Input, Modal, Switch, buttonClasses, useToast } from '../../components/ui';
import { loadInitialize } from '../../lib/api';

export interface ICalOptions {
  unmonitored: boolean;
  premieresOnly: boolean;
  asAllDay: boolean;
  pastDays: number;
  futureDays: number;
}

export const defaultICalOptions: ICalOptions = {
  unmonitored: false,
  premieresOnly: false,
  asAllDay: false,
  pastDays: 7,
  futureDays: 28,
};

const clampDays = (v: number) => (Number.isFinite(v) ? Math.min(365, Math.max(0, Math.trunc(v))) : 0);

/** `${origin}${urlBase}/feed/v3/calendar/sonarr.ics?apikey=...&pastDays=...` */
export function buildFeedUrl(origin: string, urlBase: string, apiKey: string, options: ICalOptions): string {
  const query = new URLSearchParams({
    apikey: apiKey,
    pastDays: String(clampDays(options.pastDays)),
    futureDays: String(clampDays(options.futureDays)),
    unmonitored: String(options.unmonitored),
    premieresOnly: String(options.premieresOnly),
    asAllDay: String(options.asAllDay),
  });
  return `${origin}${urlBase}/feed/v3/calendar/sonarr.ics?${query.toString()}`;
}

/** Same feed for calendar apps: http(s):// -> webcal://. */
export const webcalUrl = (url: string) => url.replace(/^https?:\/\//, 'webcal://');

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand?.('copy');
  area.remove();
  if (!ok) throw new Error('Copy is not available');
}

export function ICalModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [options, setOptions] = useState<ICalOptions>(defaultICalOptions);
  const [init, setInit] = useState<{ apiKey: string; urlBase: string } | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    loadInitialize()
      .then(({ apiKey, urlBase }) => {
        if (!cancelled) setInit({ apiKey: apiKey ?? '', urlBase: urlBase ?? '' });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const url = init ? buildFeedUrl(window.location.origin, init.urlBase, init.apiKey, options) : '';
  const set = <K extends keyof ICalOptions>(key: K, value: ICalOptions[K]) => setOptions((o) => ({ ...o, [key]: value }));

  const copy = async () => {
    try {
      await copyText(url);
      toast.success('Copied the iCal link');
    } catch {
      toast.error('Could not copy the link. Select it and copy it manually.');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="iCal feed"
      description="Subscribe to your calendar from Google Calendar, Apple Calendar, Outlook or any app that reads iCal feeds."
      size="lg"
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Include unmonitored" inline>
            <Switch checked={options.unmonitored} onCheckedChange={(v) => set('unmonitored', v)} />
          </FormField>
          <FormField label="Season premieres only" inline>
            <Switch checked={options.premieresOnly} onCheckedChange={(v) => set('premieresOnly', v)} />
          </FormField>
          <FormField label="Show as all-day events" inline>
            <Switch checked={options.asAllDay} onCheckedChange={(v) => set('asAllDay', v)} />
          </FormField>
          <div />
          <FormField label="Past days" help="Days before today to include (0-365).">
            <Input
              type="number"
              min={0}
              max={365}
              value={options.pastDays}
              onChange={(e) => set('pastDays', clampDays(e.target.valueAsNumber))}
            />
          </FormField>
          <FormField label="Future days" help="Days after today to include (0-365).">
            <Input
              type="number"
              min={0}
              max={365}
              value={options.futureDays}
              onChange={(e) => set('futureDays', clampDays(e.target.valueAsNumber))}
            />
          </FormField>
        </div>

        <FormField label="Feed URL">
          <Input readOnly value={loadError ? '' : url} placeholder={loadError ? 'Could not load the API key' : 'Loading...'} onFocus={(e) => e.currentTarget.select()} />
        </FormField>

        <div role="note" className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-sm text-text">
          <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-warning" />
          <p>
            <strong className="font-semibold">This link contains your API key.</strong> Anyone with it can read your calendar and use
            Sonarr's API, so only share it with apps you trust. Resetting the API key invalidates it.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="primary" icon={<Copy aria-hidden="true" />} disabled={!url} onClick={() => void copy()}>
            Copy link
          </Button>
          {url ? (
            <a href={webcalUrl(url)} className={buttonClasses('secondary')}>
              <Rss aria-hidden="true" className="size-4" />
              Subscribe
            </a>
          ) : (
            <Button icon={<Rss aria-hidden="true" />} disabled>
              Subscribe
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
