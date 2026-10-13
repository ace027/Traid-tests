import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { axe } from 'vitest-axe';
import type { CalendarEpisode } from '@sonarr/shared';
import { ToastProvider } from '../../components/ui';
import { mockApi, type MockApi } from '../../test/server';
import { makeEpisode, makeEpisodeFile, makeSeries } from '../series/fixtures';
import { Calendar } from './Calendar';
import { episodeStatus, viewRange } from './hooks';

function renderCalendar() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <MemoryRouter>
          <main>
            <Calendar />
          </main>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// Tuesday 13 October 2026, noon local time.
const NOW = new Date(2026, 9, 13, 12, 0, 0);
const at = (day: number, hour: number, month = 9) => new Date(2026, month, day, hour, 0, 0).toISOString();

const uiConfig = (firstDayOfWeek: 0 | 1 = 0, enableColorImpairedMode = false) => ({
  id: 1,
  firstDayOfWeek,
  calendarWeekColumnHeader: 'ddd M/D',
  shortDateFormat: 'MMM D YYYY',
  longDateFormat: 'dddd, MMMM D YYYY',
  timeFormat: 'h(:mm)a',
  showRelativeDates: true,
  theme: 'dark',
  enableColorImpairedMode,
});

const ep = (overrides: Partial<CalendarEpisode>): CalendarEpisode => ({
  ...makeEpisode({ hasFile: false, monitored: true }),
  series: makeSeries({ monitored: true }),
  ...overrides,
});

/** One episode per status, plus one without an air time. */
const statusEpisodes = (): CalendarEpisode[] => [
  ep({ id: 1, episodeNumber: 1, title: 'On Disk', airDateUtc: at(13, 6), airDate: '2026-10-13', hasFile: true, episodeFileId: 501, episodeFile: makeEpisodeFile() }),
  ep({ id: 2, episodeNumber: 2, title: 'Not Grabbed', airDateUtc: at(13, 9), airDate: '2026-10-13' }),
  ep({ id: 3, episodeNumber: 3, title: 'Tonight', airDateUtc: at(13, 21), airDate: '2026-10-13' }),
  ep({ id: 4, episodeNumber: 4, title: 'Next Week', airDateUtc: at(16, 21), airDate: '2026-10-16' }),
  ep({ id: 5, episodeNumber: 5, title: 'Ignored', airDateUtc: at(15, 21), airDate: '2026-10-15', monitored: false }),
  ep({ id: 6, episodeNumber: 6, title: 'No Time Yet', airDateUtc: undefined, airDate: '2026-10-17' }),
];

let api: MockApi;

function setup(options: { episodes?: CalendarEpisode[]; firstDayOfWeek?: 0 | 1; colorImpaired?: boolean } = {}) {
  api = mockApi({
    'GET config/ui': () => uiConfig(options.firstDayOfWeek ?? 0, options.colorImpaired ?? false),
    'GET calendar': () => options.episodes ?? statusEpisodes(),
  });
}

function mockMatchMedia(desktop: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: desktop,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

const lastCalendarQuery = () => api.callsTo('GET', 'calendar').at(-1)!.query;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  localStorage.clear();
});

afterEach(() => {
  api?.restore();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('calendar helpers', () => {
  it('builds whole-week ranges, including weeks across a year boundary', () => {
    const month = viewRange('month', NOW, 0);
    expect(month.start).toEqual(new Date(2026, 8, 27));
    expect(month.end).toEqual(new Date(2026, 10, 1));
    expect(month.days).toHaveLength(35);

    const newYear = viewRange('week', new Date(2026, 11, 31), 1);
    expect(newYear.start).toEqual(new Date(2026, 11, 28));
    expect(newYear.end).toEqual(new Date(2027, 0, 4));
    expect(newYear.days.map((d) => d.getDate())).toEqual([28, 29, 30, 31, 1, 2, 3]);
  });

  it('derives the status from file, monitoring and air time', () => {
    const [onDisk, missing, soon, unaired, unmonitored, noTime] = statusEpisodes();
    expect(episodeStatus(onDisk, NOW)).toBe('downloaded');
    expect(episodeStatus(missing, NOW)).toBe('missing');
    expect(episodeStatus(soon, NOW)).toBe('airingSoon');
    expect(episodeStatus(unaired, NOW)).toBe('unaired');
    expect(episodeStatus(unmonitored, NOW)).toBe('unmonitored');
    expect(episodeStatus(noTime, NOW)).toBe('unaired');
    // A date-only episode is missing once its whole day has passed.
    expect(episodeStatus(noTime, new Date(2026, 9, 18, 0, 1))).toBe('missing');
  });
});

describe('Calendar', () => {
  it('requests the visible month and moves with Previous, Next and Today', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    setup();
    renderCalendar();
    expect(screen.getByRole('heading', { level: 1, name: 'Calendar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(api.callsTo('GET', 'calendar').length).toBeGreaterThan(0));
    expect(lastCalendarQuery().get('start')).toBe(new Date(2026, 8, 27).toISOString());
    expect(lastCalendarQuery().get('end')).toBe(new Date(2026, 10, 1).toISOString());
    expect(lastCalendarQuery().get('unmonitored')).toBe('false');
    expect(screen.getByTestId('calendar-range')).toHaveTextContent('October 2026');

    await user.click(screen.getByRole('button', { name: 'Next month' }));
    expect(screen.getByTestId('calendar-range')).toHaveTextContent('November 2026');
    await waitFor(() => expect(lastCalendarQuery().get('start')).toBe(new Date(2026, 10, 1).toISOString()));
    expect(lastCalendarQuery().get('end')).toBe(new Date(2026, 11, 6).toISOString());

    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    await user.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(screen.getByTestId('calendar-range')).toHaveTextContent('September 2026');

    await user.click(screen.getByRole('button', { name: 'Today' }));
    expect(screen.getByTestId('calendar-range')).toHaveTextContent('October 2026');
  });

  it('requests the week from the configured first day and persists the view', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    setup({ firstDayOfWeek: 1 });
    renderCalendar();
    await user.click(screen.getByRole('button', { name: 'Week' }));
    expect(screen.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
    expect(JSON.parse(localStorage.getItem('sonarr.calendar')!)).toMatchObject({ view: 'week' });
    await waitFor(() => expect(lastCalendarQuery().get('start')).toBe(new Date(2026, 9, 12).toISOString()));
    expect(lastCalendarQuery().get('end')).toBe(new Date(2026, 9, 19).toISOString());

    await user.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(lastCalendarQuery().get('start')).toBe(new Date(2026, 9, 19).toISOString()));
  });

  it('shows the week across a year boundary', async () => {
    vi.setSystemTime(new Date(2026, 11, 30, 12));
    localStorage.setItem('sonarr.calendar', JSON.stringify({ view: 'week' }));
    setup({ episodes: [ep({ id: 9, title: 'New Year Special', airDateUtc: new Date(2027, 0, 1, 20).toISOString(), airDate: '2027-01-01' })] });
    renderCalendar();
    const range = screen.getByTestId('calendar-range');
    expect(range).toHaveTextContent('2026');
    expect(range).toHaveTextContent('2027');
    await waitFor(() => expect(lastCalendarQuery().get('end')).toBe(new Date(2027, 0, 3).toISOString()));
    const friday = await screen.findByRole('region', { name: /January 1, 2027/ });
    expect(await within(friday).findByText(/New Year Special/)).toBeInTheDocument();
  });

  it('renders statuses as text in the agenda, with times or Time TBA', async () => {
    localStorage.setItem('sonarr.calendar', JSON.stringify({ view: 'agenda' }));
    setup();
    renderCalendar();
    const item = (title: string) => (screen.getByText(new RegExp(title)).closest('li') as HTMLElement);
    await screen.findByText(/On Disk/);
    expect(within(item('On Disk')).getByText('Downloaded')).toBeInTheDocument();
    expect(within(item('On Disk')).getByText('HDTV-720p')).toBeInTheDocument();
    expect(within(item('Not Grabbed')).getByText('Missing')).toBeInTheDocument();
    expect(within(item('Tonight')).getByText('Airing soon')).toBeInTheDocument();
    expect(within(item('Next Week')).getByText('Unaired')).toBeInTheDocument();
    expect(within(item('Ignored')).getByText('Unmonitored')).toBeInTheDocument();
    expect(within(item('No Time Yet')).getByText('Time TBA')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: /October 13, 2026/ })).toHaveTextContent('Today');
  });

  it('defaults to the agenda at mobile width and to the month on desktop', () => {
    mockMatchMedia(false);
    setup();
    const { unmount } = renderCalendar();
    expect(screen.getByRole('button', { name: 'Agenda' })).toHaveAttribute('aria-pressed', 'true');
    unmount();

    mockMatchMedia(true);
    renderCalendar();
    expect(screen.getByRole('button', { name: 'Month' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends unmonitored when Show unmonitored is on', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    setup();
    renderCalendar();
    await user.click(screen.getByRole('switch', { name: 'Show unmonitored' }));
    await waitFor(() => expect(lastCalendarQuery().get('unmonitored')).toBe('true'));
    expect(JSON.parse(localStorage.getItem('sonarr.calendar')!)).toMatchObject({ showUnmonitored: true });
  });

  it('collapses a crowded day into +N more and moves between days with the arrow keys', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    const crowded = Array.from({ length: 7 }, (_, i) =>
      ep({ id: 100 + i, episodeNumber: i + 1, title: `Ep ${i + 1}`, airDateUtc: at(14, 8 + i), airDate: '2026-10-14' }),
    );
    setup({ episodes: crowded });
    renderCalendar();
    const grid = screen.getByRole('grid', { name: 'October 2026' });
    const wednesday = within(grid).getByRole('gridcell', { name: /October 14, 2026/ });
    await waitFor(() => expect(within(wednesday).getAllByRole('link')).toHaveLength(2));
    expect(wednesday).toHaveAccessibleName(/7 episodes/);

    await user.click(within(wednesday).getByRole('button', { name: /5 more episodes/ }));
    const popover = screen.getByRole('dialog', { name: /Episodes on Wednesday, October 14, 2026/ });
    expect(within(popover).getAllByRole('link')).toHaveLength(7);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    const today = within(grid).getByRole('gridcell', { name: /October 13, 2026, today/ });
    expect(today).toHaveAttribute('aria-current', 'date');
    expect(today).toHaveAttribute('tabindex', '0');
    today.focus();
    fireEvent.keyDown(today, { key: 'ArrowRight' });
    expect(wednesday).toHaveFocus();
    fireEvent.keyDown(wednesday, { key: 'ArrowDown' });
    expect(within(grid).getByRole('gridcell', { name: /October 21, 2026/ })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(within(grid).getByRole('gridcell', { name: /October 18, 2026/ })).toHaveFocus();
  });

  it('adds text and patterns in colour-impaired mode', async () => {
    setup({ colorImpaired: true });
    renderCalendar();
    const grid = screen.getByRole('grid');
    const cell = within(grid).getByRole('gridcell', { name: /October 13, 2026/ });
    const link = await within(cell).findByRole('link', { name: /S01E02/ });
    expect(within(link).getByText('Missing')).toBeInTheDocument();
    expect(link.getAttribute('style') ?? '').toContain('repeating-linear-gradient');
  });

  it('builds the iCal URL from the options and copies it', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    setup();
    renderCalendar();
    await user.click(screen.getByRole('button', { name: 'iCal' }));
    const dialog = screen.getByRole('dialog', { name: 'iCal feed' });
    const input = within(dialog).getByLabelText('Feed URL') as HTMLInputElement;
    await waitFor(() => expect(input.value).toContain('/feed/v3/calendar/sonarr.ics?'));
    let url = new URL(input.value);
    expect(url.origin).toBe(window.location.origin);
    expect(url.pathname).toBe('/feed/v3/calendar/sonarr.ics');
    expect(url.searchParams.get('apikey')).toBe('test-key');
    expect(url.searchParams.get('pastDays')).toBe('7');
    expect(url.searchParams.get('futureDays')).toBe('28');
    expect(url.searchParams.get('unmonitored')).toBe('false');
    expect(dialog).toHaveTextContent('This link contains your API key');

    await user.click(within(dialog).getByRole('switch', { name: 'Include unmonitored' }));
    await user.click(within(dialog).getByRole('switch', { name: 'Season premieres only' }));
    await user.click(within(dialog).getByRole('switch', { name: 'Show as all-day events' }));
    const past = within(dialog).getByRole('spinbutton', { name: 'Past days' });
    await user.clear(past);
    await user.type(past, '3');
    url = new URL(input.value);
    expect(url.searchParams.get('unmonitored')).toBe('true');
    expect(url.searchParams.get('premieresOnly')).toBe('true');
    expect(url.searchParams.get('asAllDay')).toBe('true');
    expect(url.searchParams.get('pastDays')).toBe('3');

    expect(within(dialog).getByRole('link', { name: 'Subscribe' }).getAttribute('href')).toBe(input.value.replace(/^https?:\/\//, 'webcal://'));
    await user.click(within(dialog).getByRole('button', { name: 'Copy link' }));
    expect(await navigator.clipboard.readText()).toBe(input.value);
    expect(await screen.findByText('Copied the iCal link')).toBeInTheDocument();
  });

  it('builds the iCal URL with the URL base', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    api = mockApi({ 'GET config/ui': () => uiConfig(), 'GET calendar': () => [] }, { urlBase: '/sonarr', apiKey: 'k3y' });
    renderCalendar();
    await user.click(screen.getByRole('button', { name: 'iCal' }));
    const input = screen.getByLabelText('Feed URL') as HTMLInputElement;
    await waitFor(() => expect(input.value).toContain(`${window.location.origin}/sonarr/feed/v3/calendar/sonarr.ics?apikey=k3y`));
  });

  it.each(['month', 'week', 'agenda'] as const)('has no axe violations in the %s view', async (view) => {
    localStorage.setItem('sonarr.calendar', JSON.stringify({ view }));
    setup();
    const { container } = renderCalendar();
    await screen.findAllByRole('link', { name: /Breaking Bad/ });
    expect((await axe(container)).violations).toEqual([]);
  });

  it('has no axe violations with the iCal modal open', async () => {
    const user = userEvent.setup({ advanceTimers: () => {} });
    setup();
    renderCalendar();
    await user.click(screen.getByRole('button', { name: 'iCal' }));
    await waitFor(() => expect((screen.getByLabelText('Feed URL') as HTMLInputElement).value).not.toBe(''));
    expect((await axe(document.body)).violations).toEqual([]);
  });
});
