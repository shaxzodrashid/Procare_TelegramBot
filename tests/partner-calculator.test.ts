import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpRepairOrderService, RepairOrderError } from '../src/services/repair-order.service.js';
import { formatProblemList } from '../src/bot/formatters.js';
import { problemsKeyboard } from '../src/bot/keyboards.js';
import type { ProblemCategory } from '../src/types/repair-order.js';
import type { Logger } from '../src/utils/logger.js';

const logger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  extra: () => undefined,
  table: () => undefined,
};
const problem = {
  id: 'service',
  parent_id: null,
  name_uz: 'Xizmat',
  name_ru: 'Услуга',
  name_en: 'Service',
  price: '0',
  cost: '0',
  estimated_minutes: 10,
  warranty_period: 3,
  sort: 1,
  is_disabled: false,
  stock_available: true,
  pricing_status: 'priced',
  required_parts: [],
  currency: { id: 'currency', code: 'USD', symbol: '$', minor_unit: 2 },
};
const page = (row: unknown) => ({ meta: { total: 1, limit: 100, offset: 0 }, data: [row] });

describe('partner calculator gateway and presentation', () => {
  it('sends Basic credentials only on protected calls and validates the V2 page', async () => {
    const calls: Array<{ url: string; auth: string | null }> = [];
    const gateway = new HttpRepairOrderService(
      {
        baseUrl: 'http://crm.test',
        username: 'test-bot',
        password: 'test-secret',
        timeoutMs: 1000,
        maxRetries: 0,
        fetchImpl: async (url, init) => {
          calls.push({ url: String(url), auth: new Headers(init?.headers).get('authorization') });
          return Response.json(String(url).includes('/telegram/clients/') ? page(problem) : []);
        },
      },
      logger,
    );
    assert.deepEqual(await gateway.getProblemCategories('phone', 'client'), [problem]);
    await gateway.getProblemCategories('phone');
    assert.equal(calls[0]?.auth, `Basic ${Buffer.from('test-bot:test-secret').toString('base64')}`);
    assert.equal(calls[1]?.auth, null);
    assert.match(calls[0]!.url, /clients\/client\/calculator-v2.*limit=100&offset=0/);
  });
  for (const row of [
    { ...problem, cost: 0 },
    { ...problem, is_disabled: 'false' },
    { ...problem, currency: null },
    { ...problem, estimated_minutes: '10' },
  ]) {
    it('rejects malformed protected response values', async () => {
      const gateway = new HttpRepairOrderService(
        {
          baseUrl: 'http://crm.test',
          username: 'bot',
          password: 'secret',
          timeoutMs: 1000,
          maxRetries: 0,
          fetchImpl: async () => Response.json(page(row)),
        },
        logger,
      );
      await assert.rejects(
        gateway.getProblemCategories('phone', 'client'),
        (error: unknown) => error instanceof RepairOrderError && error.code === 'invalid_response',
      );
    });
  }
  it('renders currencies and unavailable copy in both locales; disabled rows are not selectable', () => {
    for (const locale of ['uz', 'ru'] as const) {
      const rows = [
        problem,
        { ...problem, id: 'disabled', cost: null, is_disabled: true },
      ] as ProblemCategory[];
      const text = formatProblemList(rows, locale);
      assert.match(text, /USD|\$/);
      assert.match(text, locale === 'uz' ? /Narx mavjud emas/ : /Цена недоступна/);
      const buttons = JSON.stringify(problemsKeyboard(rows, [], locale));
      assert.match(buttons, /problem:0/);
      assert.doesNotMatch(buttons, /problem:1/);
      assert.doesNotMatch(
        JSON.stringify(problemsKeyboard(rows, [], locale, 0, true)),
        /problem:done|problem:0/,
      );
    }
  });
});

// Run against CRM's local Postman simulation, not injected fetch or live services.
describe(
  'partner calculator real HTTP simulation',
  { skip: !process.env.PARTNER_CALCULATOR_SIM_URL },
  () => {
    const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const gateway = () =>
      new HttpRepairOrderService(
        {
          baseUrl: process.env.PARTNER_CALCULATOR_SIM_URL!,
          username: 'test-bot',
          password: 'test-secret',
          timeoutMs: 5000,
          maxRetries: 0,
        },
        logger,
      );
    it('runs the actual gateway through two authenticated HTTP pages including free/unavailable labor', async () => {
      const rows = await gateway().getProblemCategories(uuid(20), uuid(1));
      assert.equal(rows.length, 101);
      assert.equal(rows[0]?.cost, '0');
      assert.equal(rows[0]?.is_disabled, false);
      assert.equal(rows[100]?.cost, null);
    });
    it('preserves upstream client-not-found and service failures', async () => {
      await assert.rejects(
        gateway().getProblemCategories(uuid(20), uuid(999)),
        (error: unknown) =>
          error instanceof RepairOrderError &&
          error.status === 404 &&
          error.message === 'Client not found',
      );
      await assert.rejects(
        gateway().getProblemCategories(uuid(999), uuid(1)),
        (error: unknown) =>
          error instanceof RepairOrderError &&
          error.code === 'maintenance' &&
          error.message === 'Pricing database unavailable',
      );
    });
  },
);
