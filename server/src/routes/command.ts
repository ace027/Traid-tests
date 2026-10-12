import type { FastifyInstance } from 'fastify';
import { commandInputSchema } from '@sonarr/shared';
import { toApiCommand } from '../services/commands.js';

const parseId = (v: string) => (/^\d+$/.test(v) ? Number(v) : -1);

export async function commandRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/v3/command', async () => app.commands.list().map(toApiCommand));

  app.get<{ Params: { id: string } }>('/api/v3/command/:id', async (req, reply) => {
    const row = app.commands.get(parseId(req.params.id));
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    return toApiCommand(row);
  });

  app.post('/api/v3/command', async (req, reply) => {
    const { name, ...body } = commandInputSchema.parse(req.body);
    if (!app.commands.has(name)) return reply.code(400).send({ message: 'Unknown command' });
    return reply.code(201).send(app.commands.enqueue(name, body, 'manual'));
  });

  app.delete<{ Params: { id: string } }>('/api/v3/command/:id', async (req, reply) => {
    const id = parseId(req.params.id);
    const row = app.commands.get(id);
    if (!row) return reply.code(404).send({ message: 'NotFound' });
    if (!app.commands.abort(id)) return reply.code(400).send({ message: 'Only queued commands can be cancelled' });
    return reply.code(200).send({});
  });
}
