import { afterEach, describe, expect, it } from 'vitest';
import { createTestApp, type TestApp } from '../test/helpers.js';
import { Scheduler } from './scheduler.js';

let t: TestApp | undefined;
afterEach(async () => {
  await t?.cleanup();
  t = undefined;
});

const MIN = 60_000;

function setup(start = Date.parse('2026-01-01T00:00:00.000Z')) {
  const clock = { ms: start };
  const scheduler = new Scheduler(t!.app, { now: () => new Date(clock.ms) });
  return { clock, scheduler };
}

describe('scheduler', () => {
  it('registers the default tasks via the system/task route', async () => {
    t = await createTestApp();
    const res = await t.app.inject({ method: 'GET', url: '/api/v3/system/task', headers: { 'x-api-key': t.apiKey } });
    const tasks = res.json() as { name: string; interval: number }[];
    expect(tasks.map((x) => [x.name, x.interval])).toEqual([
      ['Housekeeping', 1440],
      ['RefreshMonitoredDownloads', 1],
      ['RefreshSeries', 720],
      ['RssSync', 15],
    ]);
    const one = await t.app.inject({ method: 'GET', url: '/api/v3/system/task/RssSync', headers: { 'x-api-key': t.apiKey } });
    expect(one.json().commandName).toBe('RssSync');
    const missing = await t.app.inject({ method: 'GET', url: '/api/v3/system/task/Nope', headers: { 'x-api-key': t.apiKey } });
    expect(missing.statusCode).toBe(404);
  });

  it('ensureTask computes the next execution and keeps the last execution', async () => {
    t = await createTestApp();
    const { clock, scheduler } = setup();
    scheduler.ensureTask('Custom', 'Custom', 10);
    expect(scheduler.getTask('Custom')!.nextExecution).toBe('2026-01-01T00:10:00.000Z');
    t.app.sqlite.prepare("update scheduled_tasks set last_execution = '2026-01-01T00:02:00.000Z' where name = 'Custom'").run();
    clock.ms += 5 * MIN;
    scheduler.ensureTask('Custom', 'Custom', 30);
    const row = scheduler.getTask('Custom')!;
    expect(row.lastExecution).toBe('2026-01-01T00:02:00.000Z');
    expect(row.nextExecution).toBe('2026-01-01T00:32:00.000Z');
    scheduler.stop();
  });

  it('tick enqueues only due and registered commands as scheduled', async () => {
    t = await createTestApp();
    const { clock, scheduler } = setup();
    let ran = 0;
    t.app.commands.register('Ticker', async () => {
      ran++;
    });
    scheduler.ensureTask('Ticker', 'Ticker', 5);
    scheduler.ensureTask('Ghost', 'NotRegistered', 5);
    scheduler.ensureTask('Later', 'Ticker', 60);
    expect(scheduler.tick()).toEqual([]);
    clock.ms += 5 * MIN;
    expect(scheduler.tick()).toEqual(['Ticker']);
    await t.app.commands.waitForIdle();
    expect(ran).toBe(1);
    const rows = t.app.sqlite.prepare("select name, trigger from commands where name in ('Ticker','NotRegistered')").all();
    expect(rows).toEqual([{ name: 'Ticker', trigger: 'scheduled' }]);
    scheduler.stop();
  });

  it('does not double-enqueue while a command is queued or running, and updates times on completion', async () => {
    t = await createTestApp();
    const { clock, scheduler } = setup();
    let release!: () => void;
    t.app.commands.register('Slow', () => new Promise<void>((r) => (release = r)));
    scheduler.ensureTask('Slow', 'Slow', 5);
    clock.ms += 5 * MIN;
    expect(scheduler.tick()).toEqual(['Slow']);
    expect(scheduler.getTask('Slow')!.lastStartTime).toBe('2026-01-01T00:05:00.000Z');
    clock.ms += 10 * MIN;
    expect(scheduler.tick()).toEqual([]);
    expect(t.app.sqlite.prepare("select count(*) as n from commands where name = 'Slow'").get()).toEqual({ n: 1 });
    release();
    await t.app.commands.waitForIdle();
    const row = scheduler.getTask('Slow')!;
    expect(row.lastExecution).toBeTruthy();
    expect(Date.parse(row.nextExecution)).toBe(Date.parse(row.lastExecution!) + 5 * MIN);
    scheduler.stop();
  });

  it('runNow enqueues immediately and reports unknown tasks', async () => {
    t = await createTestApp();
    const { scheduler } = setup();
    let ran = 0;
    t.app.commands.register('Now', async () => {
      ran++;
    });
    scheduler.ensureTask('Now', 'Now', 1000);
    expect(scheduler.runNow('Now')).toBe(true);
    await t.app.commands.waitForIdle();
    expect(ran).toBe(1);
    expect(scheduler.runNow('Missing')).toBe(false);
    scheduler.stop();
  });
});
