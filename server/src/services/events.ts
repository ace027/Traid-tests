import type { ServerEvent, ServerEventAction } from '@sonarr/shared';

export type EventListener = (event: ServerEvent) => void;

const BUFFER_SIZE = 500;

export class EventBus {
  private nextId: number;
  private buffer: ServerEvent[] = [];
  private listeners = new Set<EventListener>();

  // Ids are seeded from the clock so they stay unique across restarts; a client
  // reconnecting with a pre-restart Last-Event-ID then never exceeds the counter.
  constructor(startId: number = Date.now()) {
    this.nextId = startId;
  }

  publish(name: string, action: ServerEventAction, resource?: Record<string, unknown>): ServerEvent {
    const event: ServerEvent = { id: this.nextId++, name, action, at: new Date().toISOString() };
    if (resource !== undefined) event.resource = resource;
    this.buffer.push(event);
    if (this.buffer.length > BUFFER_SIZE) this.buffer.splice(0, this.buffer.length - BUFFER_SIZE);
    for (const fn of [...this.listeners]) {
      try {
        fn(event);
      } catch {
        // a failing listener must not break publishing
      }
    }
    return event;
  }

  subscribe(fn: EventListener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  since(id: number): ServerEvent[] {
    return this.buffer.filter((e) => e.id > id);
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}
