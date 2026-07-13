import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SystemHealthMonitor,
  type SystemHealthMonitorOptions,
} from '../src/services/health.service.js';

const healthyDatabase = {
  async raw() {},
} as unknown as SystemHealthMonitorOptions['database'];

describe('SystemHealthMonitor', () => {
  it('reports ok when required process parts are ready', async () => {
    const monitor = new SystemHealthMonitor({
      database: healthyDatabase,
      botEnabled: false,
      apiEnabled: true,
    });

    monitor.markMigrationsCompleted();
    monitor.markApiListening();

    const snapshot = await monitor.snapshot();

    assert.equal(snapshot.status, 'ok');
    assert.equal(snapshot.checks.database.status, 'ok');
    assert.equal(snapshot.checks.telegram.status, 'disabled');
  });

  it('reports unhealthy when database probing fails', async () => {
    const monitor = new SystemHealthMonitor({
      database: {
        async raw() {
          throw new Error('database unavailable');
        },
      } as unknown as SystemHealthMonitorOptions['database'],
      botEnabled: false,
      apiEnabled: true,
    });

    monitor.markMigrationsCompleted();
    monitor.markApiListening();

    const snapshot = await monitor.snapshot();

    assert.equal(snapshot.status, 'unhealthy');
    assert.equal(snapshot.checks.database.status, 'unhealthy');
    assert.equal(snapshot.checks.database.message, 'database unavailable');
  });

  it('requires authenticated running Telegram polling when the bot is enabled', async () => {
    const monitor = new SystemHealthMonitor({
      database: healthyDatabase,
      botEnabled: true,
      apiEnabled: true,
    });

    monitor.markMigrationsCompleted();
    monitor.markApiListening();
    monitor.markBotAuthenticated('procare_bot');

    let snapshot = await monitor.snapshot();

    assert.equal(snapshot.status, 'unhealthy');
    assert.equal(snapshot.checks.telegram.message, 'Telegram polling is starting');

    monitor.markBotPollingRunning('procare_bot');
    monitor.setTelegramProbe(async () => ({ id: 1, username: 'procare_bot' }));
    snapshot = await monitor.snapshot();

    assert.equal(snapshot.status, 'ok');
    assert.equal(snapshot.checks.telegram.status, 'ok');
  });
});
