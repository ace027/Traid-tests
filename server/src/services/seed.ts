import { eq } from 'drizzle-orm';
import { defaultQualityDefinitions, defaultQualityProfiles, type UiConfig } from '@sonarr/shared';
import { schema, type Db } from '../db/index.js';

export const defaultUiConfig: UiConfig = {
  id: 1,
  firstDayOfWeek: 0,
  calendarWeekColumnHeader: 'ddd M/D',
  shortDateFormat: 'MMM D YYYY',
  longDateFormat: 'dddd, MMMM D YYYY',
  timeFormat: 'h(:mm)a',
  showRelativeDates: true,
  theme: 'system',
  enableColorImpairedMode: false,
};

export function getUiConfig(db: Db): UiConfig {
  const row = db.select().from(schema.config).where(eq(schema.config.key, 'ui')).get();
  return row ? { ...defaultUiConfig, ...(JSON.parse(row.value) as Partial<UiConfig>) } : defaultUiConfig;
}

export function seed(db: Db): void {
  db.transaction((tx) => {
    if (!tx.select().from(schema.qualityDefinitions).limit(1).get()) {
      for (const d of defaultQualityDefinitions) {
        tx.insert(schema.qualityDefinitions)
          .values({
            quality: d.quality.id,
            title: d.title,
            weight: d.weight,
            minSize: d.minSize,
            maxSize: d.maxSize,
            preferredSize: d.preferredSize,
          })
          .run();
      }
    }
    if (!tx.select().from(schema.qualityProfiles).limit(1).get()) {
      for (const p of defaultQualityProfiles) {
        tx.insert(schema.qualityProfiles)
          .values({
            name: p.name,
            upgradeAllowed: p.upgradeAllowed,
            cutoff: p.cutoff,
            items: JSON.stringify(p.items.map((i) => ({ quality: i.quality.id, allowed: i.allowed }))),
          })
          .run();
      }
    }
    if (!tx.select().from(schema.config).where(eq(schema.config.key, 'ui')).get()) {
      tx.insert(schema.config).values({ key: 'ui', value: JSON.stringify(defaultUiConfig) }).run();
    }
  });
}
