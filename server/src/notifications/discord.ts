import type { DiscordSettings } from '@sonarr/shared';
import { detailLines, formatSize, summary } from './payload.js';
import { sendJson } from './webhook.js';
import type { NotificationEvent, NotificationMessage, NotificationProvider, ProviderContext, ProviderDeps } from './types.js';

const COLORS: Record<NotificationEvent, number> = {
  Grab: 0xf5a623,
  Download: 0x2ecc71,
  Rename: 0x9b59b6,
  EpisodeFileDelete: 0xe67e22,
  SeriesAdd: 0x3498db,
  SeriesDelete: 0x95a5a6,
  Health: 0xe74c3c,
  HealthRestored: 0x2ecc71,
  Test: 0x3498db,
};

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function buildDiscordBody(message: NotificationMessage, settings: DiscordSettings, ctx: ProviderContext): Record<string, unknown> {
  const fields: { name: string; value: string; inline: boolean }[] = [];
  const quality = message.release?.quality ?? message.episodeFile?.quality;
  if (quality) fields.push({ name: 'Quality', value: clip(quality, 1024), inline: true });
  const size = message.release?.size ?? message.episodeFile?.size;
  if (size) fields.push({ name: 'Size', value: formatSize(size), inline: true });
  if (message.release?.indexer) fields.push({ name: 'Indexer', value: clip(message.release.indexer, 1024), inline: true });
  if (message.downloadClient) fields.push({ name: 'Download client', value: clip(message.downloadClient, 1024), inline: true });

  const description =
    message.release?.releaseTitle ??
    message.episodeFile?.relativePath ??
    message.health?.message ??
    detailLines(message)
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n');

  const embed: Record<string, unknown> = {
    title: clip(summary(message), 256),
    description: clip(description, 4000),
    color: COLORS[message.eventType],
    timestamp: new Date().toISOString(),
  };
  if (fields.length > 0) embed.fields = fields;
  if (message.series?.posterUrl) embed.thumbnail = { url: message.series.posterUrl };

  const body: Record<string, unknown> = { username: settings.username || ctx.instanceName || 'Sonarr', embeds: [embed] };
  if (settings.avatar) body.avatar_url = settings.avatar;
  return body;
}

export class DiscordProvider implements NotificationProvider {
  constructor(
    private readonly settings: DiscordSettings,
    private readonly ctx: ProviderContext,
    private readonly deps: ProviderDeps = {},
  ) {}

  async send(message: NotificationMessage): Promise<void> {
    await sendJson(
      { label: 'Discord', url: this.settings.webHookUrl, method: 'POST', body: buildDiscordBody(message, this.settings, this.ctx), retryRateLimit: true },
      this.deps,
    );
  }

  test(): Promise<void> {
    return this.send({ eventType: 'Test', series: { id: 1, title: 'Test Title', path: '/tv/Test Title', tvdbId: 1234, tvMazeId: 1234, type: 'standard' } });
  }
}
