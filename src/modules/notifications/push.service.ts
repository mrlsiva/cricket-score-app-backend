import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import type { App } from 'firebase-admin/app';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/** Firebase Cloud Messaging sender. Disabled (logs only) when no service account is configured. */
@Injectable()
export class PushService implements OnModuleInit {
  private readonly logger = new Logger(PushService.name);
  private app: App | null = null;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit() {
    const path = this.config.get<string>('firebase.serviceAccountPath');
    if (!path) {
      this.logger.warn('FCM disabled (FIREBASE_SERVICE_ACCOUNT_PATH not set) - push notifications will be logged only');
      return;
    }
    const { initializeApp, cert } = await import('firebase-admin/app');
    this.app = initializeApp({ credential: cert(JSON.parse(fs.readFileSync(path, 'utf8'))) }, 'cricket-push');
    this.logger.log('FCM initialized');
  }

  get enabled() {
    return !!this.app;
  }

  /** Sends to device tokens; returns tokens FCM reported as invalid so callers can prune them. */
  async sendToTokens(tokens: string[], msg: PushMessage): Promise<string[]> {
    if (!tokens.length) return [];
    if (!this.app) {
      this.logger.debug(`[push:tokens x${tokens.length}] ${msg.title} - ${msg.body}`);
      return [];
    }
    const { getMessaging } = await import('firebase-admin/messaging');
    const invalid: string[] = [];
    for (let i = 0; i < tokens.length; i += 500) {
      const batch = tokens.slice(i, i + 500);
      const res = await getMessaging(this.app).sendEachForMulticast({
        tokens: batch,
        notification: { title: msg.title, body: msg.body },
        data: msg.data,
        android: { priority: 'high' },
      });
      res.responses.forEach((r, idx) => {
        const code = r.error?.code;
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') invalid.push(batch[idx]);
      });
    }
    return invalid;
  }

  /** Topic push - Android apps subscribe to `match_<id>` / `tournament_<id>` to follow live games. */
  async sendToTopic(topic: string, msg: PushMessage) {
    if (!this.app) {
      this.logger.debug(`[push:topic ${topic}] ${msg.title} - ${msg.body}`);
      return;
    }
    const { getMessaging } = await import('firebase-admin/messaging');
    await getMessaging(this.app).send({ topic, notification: { title: msg.title, body: msg.body }, data: msg.data, android: { priority: 'high' } });
  }

  async subscribe(tokens: string[], topic: string) {
    if (!this.app || !tokens.length) return;
    const { getMessaging } = await import('firebase-admin/messaging');
    await getMessaging(this.app).subscribeToTopic(tokens, topic);
  }

  async unsubscribe(tokens: string[], topic: string) {
    if (!this.app || !tokens.length) return;
    const { getMessaging } = await import('firebase-admin/messaging');
    await getMessaging(this.app).unsubscribeFromTopic(tokens, topic);
  }
}
