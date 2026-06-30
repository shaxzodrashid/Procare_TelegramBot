import type { Api } from 'grammy';

import { t } from '../bot/messages.js';
import type { AppConfig } from '../config/index.js';
import type { RegisteredUserMessageTarget } from '../types/registered-user.js';
import type { Logger } from '../utils/logger.js';
import { isTelegramBlockedError } from './bot-notification.service.js';
import type { MessageTemplateStore } from './message-template.service.js';
import type { RegisteredUserStore } from './registered-user.store.js';

type TelegramLifecycleApi = Pick<Api, 'sendMessage'>;
type LifecycleKind = 'startup' | 'shutdown';
type LifecycleRecipientStore = Pick<RegisteredUserStore, 'listMessageTargets'>;
type LifecycleDispatchStore = Pick<MessageTemplateStore, 'logDispatch' | 'setUserBlocked'>;

export interface LifecycleBroadcastSummary {
  kind: LifecycleKind;
  startedAt: string;
  completedAt: string;
  total: number;
  sent: number;
  failed: number;
  blocked: number;
  timedOut: boolean;
}

const dispatchType = (kind: LifecycleKind): string => `lifecycle_${kind}`;

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const startCommandKeyboard = {
  keyboard: [[{ text: '/start' }]],
  resize_keyboard: true,
  one_time_keyboard: true,
};

export class BotLifecycleNotificationService {
  constructor(
    private readonly users: LifecycleRecipientStore,
    private readonly dispatchStore: LifecycleDispatchStore,
    private readonly telegram: TelegramLifecycleApi,
    private readonly logger: Logger,
    private readonly options: Pick<
      AppConfig['lifecycleNotifications'],
      'batchSize' | 'concurrency'
    >,
  ) {}

  async notifyStartup(timeoutMs: number): Promise<LifecycleBroadcastSummary> {
    return this.broadcast('startup', timeoutMs);
  }

  async notifyShutdown(timeoutMs: number): Promise<LifecycleBroadcastSummary> {
    return this.broadcast('shutdown', timeoutMs);
  }

  private async broadcast(
    kind: LifecycleKind,
    timeoutMs: number,
  ): Promise<LifecycleBroadcastSummary> {
    const startedAtMs = Date.now();
    const deadlineMs = startedAtMs + timeoutMs;
    const summary: LifecycleBroadcastSummary = {
      kind,
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: new Date(startedAtMs).toISOString(),
      total: 0,
      sent: 0,
      failed: 0,
      blocked: 0,
      timedOut: false,
    };

    let afterId: string | undefined;
    while (Date.now() <= deadlineMs) {
      const recipients = await this.users.listMessageTargets({
        afterId,
        limit: this.options.batchSize,
        includeBlocked: false,
      });
      if (recipients.length === 0) break;

      for (let index = 0; index < recipients.length; index += this.options.concurrency) {
        if (Date.now() > deadlineMs) {
          summary.timedOut = true;
          break;
        }

        const chunk = recipients.slice(index, index + this.options.concurrency);
        const results = await Promise.all(chunk.map((recipient) => this.send(kind, recipient)));
        for (const result of results) {
          summary.total += 1;
          if (result === 'sent') summary.sent += 1;
          if (result === 'failed') summary.failed += 1;
          if (result === 'blocked') summary.blocked += 1;
        }
      }

      const lastRecipient = recipients.at(-1);
      if (!lastRecipient || recipients.length < this.options.batchSize || summary.timedOut) break;
      afterId = lastRecipient.id;
    }

    if (Date.now() > deadlineMs) summary.timedOut = true;
    summary.completedAt = new Date().toISOString();
    this.logger.info(
      `Lifecycle ${kind} notification completed: sent=${summary.sent}, failed=${summary.failed}, blocked=${summary.blocked}, timedOut=${summary.timedOut}`,
    );
    return summary;
  }

  private async send(
    kind: LifecycleKind,
    recipient: RegisteredUserMessageTarget,
  ): Promise<'sent' | 'failed' | 'blocked'> {
    const type = dispatchType(kind);
    const text = t(
      recipient.locale,
      kind === 'startup' ? 'serviceStartupNotice' : 'serviceShutdownNotice',
    );

    try {
      await this.telegram.sendMessage(
        recipient.telegram_id,
        text,
        kind === 'startup' ? { reply_markup: startCommandKeyboard } : undefined,
      );
      await this.dispatchStore.setUserBlocked(recipient.telegram_id, false);
      await this.dispatchStore.logDispatch({
        user_id: recipient.id,
        template_id: null,
        dispatch_type: type,
        status: 'sent',
        error_message: null,
      });
      return 'sent';
    } catch (error) {
      const blocked = isTelegramBlockedError(error);
      if (blocked) {
        await this.dispatchStore.setUserBlocked(recipient.telegram_id, true);
      }
      await this.dispatchStore.logDispatch({
        user_id: recipient.id,
        template_id: null,
        dispatch_type: type,
        status: 'failed',
        error_message: errorMessage(error),
      });
      this.logger.warn(`Lifecycle ${kind} notification failed for user ${recipient.id}`, error);
      return blocked ? 'blocked' : 'failed';
    }
  }
}
