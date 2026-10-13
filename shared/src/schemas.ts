import { z, ZodError } from 'zod';

/** Build a ZodError for a single invalid property; the server maps it to a Sonarr-style 400. */
export function validationError(propertyName: string, message: string): ZodError {
  return new ZodError([{ code: 'custom', path: propertyName ? propertyName.split('.') : [], message, input: undefined }]);
}

export const rootFolderInputSchema = z.object({ path: z.string().min(1) });
export type RootFolderInput = z.infer<typeof rootFolderInputSchema>;

export const rootFolderSchema = z.object({
  id: z.number().int(),
  path: z.string(),
  accessible: z.boolean(),
  freeSpace: z.number().nullable(),
  unmappedFolders: z.array(z.object({ name: z.string(), path: z.string() })),
});
export type RootFolder = z.infer<typeof rootFolderSchema>;

export const tagInputSchema = z.object({
  label: z
    .string()
    .trim()
    .toLowerCase()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9-_ ]+$/, 'Allowed characters a-z, 0-9, -, _ and space'),
});
export const tagSchema = tagInputSchema.extend({ id: z.number().int() });
export type Tag = z.infer<typeof tagSchema>;

export const qualitySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  source: z.enum(['television', 'web', 'webRip', 'dvd', 'bluray', 'blurayRaw', 'unknown']),
  resolution: z.number().int(),
});

export const qualityDefinitionSchema = z.object({
  id: z.number().int(),
  quality: qualitySchema,
  title: z.string(),
  weight: z.number().int(),
  minSize: z.number().min(0),
  maxSize: z.number().min(0).nullable(),
  preferredSize: z.number().min(0).nullable(),
});
export type QualityDefinition = z.infer<typeof qualityDefinitionSchema>;

export const qualityProfileItemSchema = z.object({
  quality: qualitySchema,
  allowed: z.boolean(),
});

export const qualityProfileSchema = z
  .object({
    id: z.number().int(),
    name: z.string().trim().min(1),
    upgradeAllowed: z.boolean(),
    cutoff: z.number().int(),
    items: z.array(qualityProfileItemSchema),
  })
  .superRefine((p, ctx) => {
    const allowed = p.items.filter((i) => i.allowed);
    if (allowed.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'At least one quality must be allowed' });
    }
    if (!allowed.some((i) => i.quality.id === p.cutoff)) {
      ctx.addIssue({ code: 'custom', path: ['cutoff'], message: 'Cutoff must be an allowed quality' });
    }
  });
export type QualityProfile = z.infer<typeof qualityProfileSchema>;

/** Body for creating a profile (id optional/ignored). */
export const qualityProfileInputSchema = z
  .object({
    id: z.number().int().optional(),
    name: z.string().trim().min(1),
    upgradeAllowed: z.boolean(),
    cutoff: z.number().int(),
    items: z.array(qualityProfileItemSchema),
  })
  .superRefine((p, ctx) => {
    const allowed = p.items.filter((i) => i.allowed);
    if (allowed.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['items'], message: 'At least one quality must be allowed' });
    }
    if (!allowed.some((i) => i.quality.id === p.cutoff)) {
      ctx.addIssue({ code: 'custom', path: ['cutoff'], message: 'Cutoff must be an allowed quality' });
    }
  });
export type QualityProfileInput = z.infer<typeof qualityProfileInputSchema>;

export const commandInputSchema = z.object({ name: z.string().min(1) }).catchall(z.unknown());

export const authenticationMethodSchema = z.enum(['forms', 'external']);
export type AuthenticationMethod = z.infer<typeof authenticationMethodSchema>;
export const authenticationRequiredSchema = z.enum(['enabled', 'disabledForLocalAddresses']);
export type AuthenticationRequired = z.infer<typeof authenticationRequiredSchema>;

const URL_BASE_CHARS = /^[A-Za-z0-9._~/-]*$/;

/** Canonical URL base: leading '/', no trailing '/', no empty, '.' or '..' segments; '' when blank. */
export function normalizeUrlBase(raw: string): string {
  const segments = raw.trim().split('/').filter(Boolean);
  return segments.length ? `/${segments.join('/')}` : '';
}

/** The single place a URL base is validated and normalized. */
export const urlBaseSchema = z
  .string()
  .trim()
  .max(200)
  .regex(URL_BASE_CHARS, 'URL base may only contain letters, digits and . _ ~ / -')
  .refine((v) => !v.split('/').some((s) => s === '.' || s === '..'), "URL base may not contain '.' or '..' segments")
  .transform(normalizeUrlBase);

const hostConfigShape = {
  id: z.literal(1),
  bindAddress: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  urlBase: urlBaseSchema,
  instanceName: z.string().min(1),
  apiKey: z.string().min(1),
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']),
  launchBrowser: z.literal(false),
  authenticationMethod: authenticationMethodSchema,
  authenticationRequired: authenticationRequiredSchema,
  username: z.string().trim().max(256),
  /** Write-only: always '' when read; '' in an update means "unchanged". */
  password: z.string().max(1024),
};

export const hostConfigSchema = z.object(hostConfigShape);
export type HostConfig = z.infer<typeof hostConfigSchema>;

/** Body of PUT /config/host: every field optional, no defaults (missing means unchanged). */
export const hostConfigUpdateSchema = z.object(hostConfigShape).partial();

/** Defaults applied to a stored host config (apiKey is generated separately). */
export const HOST_CONFIG_DEFAULTS: Omit<HostConfig, 'apiKey'> = {
  id: 1,
  bindAddress: '*',
  port: 8989,
  urlBase: '',
  instanceName: 'Sonarr',
  logLevel: 'info',
  launchBrowser: false,
  authenticationMethod: 'forms',
  authenticationRequired: 'enabled',
  username: '',
  password: '',
};

export const uiConfigSchema = z.object({
  id: z.literal(1),
  firstDayOfWeek: z.union([z.literal(0), z.literal(1)]),
  calendarWeekColumnHeader: z.string(),
  shortDateFormat: z.string(),
  longDateFormat: z.string(),
  timeFormat: z.string(),
  showRelativeDates: z.boolean(),
  theme: z.enum(['light', 'dark', 'system']),
  enableColorImpairedMode: z.boolean(),
});
export type UiConfig = z.infer<typeof uiConfigSchema>;

export const commandSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  body: z.record(z.string(), z.unknown()),
  status: z.enum(['queued', 'started', 'completed', 'failed', 'aborted']),
  priority: z.string(),
  trigger: z.enum(['manual', 'scheduled']),
  message: z.string().nullable(),
  queued: z.string(),
  started: z.string().nullable(),
  ended: z.string().nullable(),
  duration: z.string().nullable(),
});
export type Command = z.infer<typeof commandSchema>;

export const systemStatusSchema = z.object({
  appName: z.literal('Sonarr'),
  instanceName: z.string(),
  version: z.string(),
  buildTime: z.string(),
  isDebug: z.boolean(),
  isProduction: z.boolean(),
  startupPath: z.string(),
  appData: z.string(),
  osName: z.string(),
  runtimeVersion: z.string(),
  databaseType: z.literal('sqlite'),
  databaseVersion: z.string(),
  authentication: authenticationMethodSchema,
  urlBase: z.string(),
  startTime: z.string(),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;
