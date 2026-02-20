/**
 * Notification Provider interface (Feature 12, Story 12.2)
 */

import type { NotificationPayload, DeliveryResult, NotificationChannel } from '@agentlensai/core';

export interface NotificationProvider {
  readonly type: string;
  send(channel: NotificationChannel, payload: NotificationPayload): Promise<DeliveryResult>;
  testSend(channel: NotificationChannel): Promise<DeliveryResult>;
}
