import { randomBytes } from 'node:crypto';
import type { FastifyReply } from 'fastify';

export interface SSEClient {
  id: string;
  engagementId: string;
  reply: FastifyReply;
  lastEventId: number;
}

export class EventBroadcaster {
  private clients = new Map<string, SSEClient[]>();

  subscribe(engagementId: string, reply: FastifyReply): string {
    const clientId = randomBytes(8).toString('hex');
    const client: SSEClient = {
      id: clientId,
      engagementId,
      reply,
      lastEventId: 0,
    };

    const existing = this.clients.get(engagementId) ?? [];
    existing.push(client);
    this.clients.set(engagementId, existing);

    reply.raw.on('close', () => {
      const list = this.clients.get(engagementId) ?? [];
      const idx = list.findIndex((c) => c.id === clientId);
      if (idx >= 0) list.splice(idx, 1);
      if (list.length === 0) this.clients.delete(engagementId);
    });

    return clientId;
  }

  broadcast(engagementId: string, event: { type: string; data: unknown }): void {
    const clients = this.clients.get(engagementId) ?? [];
    // Include event type in the data payload so frontend onmessage fires.
    // Using a named event type (event: foo) requires addEventListener;
    // default message events work with onmessage.
    const envelope = { type: event.type, ...(event.data as Record<string, unknown>) };
    const payload = `data: ${JSON.stringify(envelope)}\n\n`;
    for (const client of clients) {
      try {
        client.reply.raw.write(payload);
      } catch {
        // Client disconnected — will be cleaned up on close
      }
    }
  }

  getClientCount(engagementId: string): number {
    return (this.clients.get(engagementId) ?? []).length;
  }

  getTotalClients(): number {
    let total = 0;
    for (const list of this.clients.values()) total += list.length;
    return total;
  }
}
