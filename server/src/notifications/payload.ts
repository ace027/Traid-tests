import type { NotificationMessage, ProviderContext } from './types.js';

const pad = (n: number) => String(n).padStart(2, '0');

/** "S01E02", or "S01E02-E03" for a run of episodes. */
export function episodeLabel(message: NotificationMessage): string {
  const eps = [...(message.episodes ?? [])].sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
  if (eps.length === 0) return '';
  const first = eps[0]!;
  const last = eps[eps.length - 1]!;
  const head = `S${pad(first.seasonNumber)}E${pad(first.episodeNumber)}`;
  if (eps.length === 1) return head;
  return last.seasonNumber === first.seasonNumber ? `${head}-E${pad(last.episodeNumber)}` : `${head} - S${pad(last.seasonNumber)}E${pad(last.episodeNumber)}`;
}

function episodeLine(message: NotificationMessage): string {
  const label = episodeLabel(message);
  const titles = (message.episodes ?? []).map((e) => e.title).filter(Boolean).join(' + ');
  return [message.series?.title, label, titles].filter(Boolean).join(' - ');
}

function qualitySuffix(message: NotificationMessage): string {
  const q = message.release?.quality ?? message.episodeFile?.quality;
  return q ? ` [${q}]` : '';
}

/** One-line description, e.g. "Grabbed: Show - S01E02 - Title [HDTV-720p]". */
export function summary(message: NotificationMessage): string {
  switch (message.eventType) {
    case 'Grab':
      return `Grabbed: ${episodeLine(message)}${qualitySuffix(message)}`;
    case 'Download':
      return `${message.isUpgrade ? 'Upgraded' : 'Imported'}: ${episodeLine(message)}${qualitySuffix(message)}`;
    case 'Rename':
      return `Renamed: ${message.series?.title ?? 'series'}`;
    case 'EpisodeFileDelete':
      return `${message.deleteReason === 'upgrade' ? 'File replaced by upgrade' : 'File deleted'}: ${episodeLine(message)}${qualitySuffix(message)}`;
    case 'SeriesAdd':
      return `Series added: ${message.series?.title ?? ''}`.trim();
    case 'SeriesDelete':
      return `Series deleted: ${message.series?.title ?? ''}`.trim();
    case 'Health':
      return `Health check failure: ${message.health?.message ?? ''}`.trim();
    case 'HealthRestored':
      return `Health check restored: ${message.health?.message ?? ''}`.trim();
    case 'Test':
      return 'Test notification from Sonarr';
  }
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${units[i]}`;
}

/** Extra plain-text lines (label, value) shared by the email body. */
export function detailLines(message: NotificationMessage): [string, string][] {
  const out: [string, string][] = [];
  const add = (label: string, value: string | number | undefined) => {
    if (value !== undefined && value !== '') out.push([label, String(value)]);
  };
  add('Series', message.series?.title);
  add('Episodes', episodeLabel(message));
  add('Release', message.release?.releaseTitle);
  add('Quality', message.release?.quality ?? message.episodeFile?.quality);
  if (message.release?.size) add('Size', formatSize(message.release.size));
  add('Indexer', message.release?.indexer);
  add('Download client', message.downloadClient);
  add('File', message.episodeFile?.relativePath);
  add('Health', message.health?.message);
  return out;
}

const drop = <T extends Record<string, unknown>>(o: T): T => {
  for (const k of Object.keys(o)) if (o[k] === undefined) delete o[k];
  return o;
};

/** Sonarr-style webhook body. */
export function buildWebhookPayload(message: NotificationMessage, ctx: ProviderContext): Record<string, unknown> {
  const body: Record<string, unknown> = {
    eventType: message.eventType,
    instanceName: ctx.instanceName,
    applicationUrl: ctx.applicationUrl,
  };
  if (message.series) {
    const s = message.series;
    body.series = { id: s.id, title: s.title, path: s.path, tvdbId: s.tvdbId, tvMazeId: s.tvMazeId, type: s.type };
  }
  if (message.episodes) {
    body.episodes = message.episodes.map((e) =>
      drop({ id: e.id, episodeNumber: e.episodeNumber, seasonNumber: e.seasonNumber, title: e.title, airDate: e.airDate }),
    );
  }
  if (message.release) {
    const r = message.release;
    body.release = drop({ quality: r.quality, releaseTitle: r.releaseTitle, indexer: r.indexer, size: r.size, releaseGroup: r.releaseGroup });
  }
  if (message.episodeFile) {
    const f = message.episodeFile;
    body.episodeFile = drop({ relativePath: f.relativePath, path: f.path, quality: f.quality, size: f.size });
  }
  if (message.eventType === 'Download') body.isUpgrade = message.isUpgrade ?? false;
  if (message.downloadClient !== undefined) body.downloadClient = message.downloadClient;
  if (message.downloadId !== undefined) body.downloadId = message.downloadId;
  if (message.deleteReason !== undefined) body.deleteReason = message.deleteReason;
  if (message.health) body.health = drop({ level: message.health.level, message: message.health.message, type: message.health.type, wikiUrl: message.health.wikiUrl });
  return body;
}
