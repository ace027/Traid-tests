export type ServerEventAction = 'created' | 'updated' | 'deleted' | 'sync';

export interface ServerEvent {
  /** Monotonically increasing integer. */
  id: number;
  /** Resource name, e.g. 'rootfolder', 'tag', 'qualityprofile', 'command'. */
  name: string;
  action: ServerEventAction;
  resource?: Record<string, unknown>;
  /** ISO timestamp. */
  at: string;
}
