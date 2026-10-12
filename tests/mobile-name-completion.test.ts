import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Bot } from 'grammy';
import type { BotContext, BotSession } from '../src/bot/context.js';
import type { BotDependencies } from '../src/bot/create-bot.js';
import { createMobileRegistrationMiddleware } from '../src/bot/handlers/mobile-registration.js';
import { registerCommandHandlers } from '../src/bot/handlers/commands.js';
import type {
  OtpSessionResponse,
  ProfileNameField,
  VerifyContactParams,
  VerifyContactResult,
} from '../src/types/otp-auth.js';
import type { RegisteredTelegramUserRecord } from '../src/types/registered-user.js';
import { summarizeSession, summarizeTelegramUpdate } from '../src/bot/session.js';
import { t } from '../src/bot/messages.js';

const setup = (fields: ProfileNameField[], locale: 'uz' | 'ru' = 'uz') => {
  const calls: VerifyContactParams[] = [];
  const saved: RegisteredTelegramUserRecord[] = [];
  const replies: Array<{ text: string; options: unknown }> = [];
  const commands: Record<string, (ctx: BotContext) => Promise<void>> = {};
  let status: OtpSessionResponse | null = { status: 'PENDING_TELEGRAM' };
  let response: VerifyContactResult = fields.length
    ? { success: false, error: 'PROFILE_NAMES_REQUIRED', missing_fields: fields }
    : { success: true };
  const session: BotSession = {
    locale,
    stage: 'awaiting_otp_contact',
    otpAuth: {
      sessionToken: 'sess_test',
      createdAt: Date.now(),
      deadline: Date.now() + 300_000,
      senderId: 123,
      chatId: 123,
    },
  };
  const dependencies = {
    otpAuthService: {
      getSession: async () => status,
      verifyContact: async (params: VerifyContactParams) => {
        calls.push(params);
        return response;
      },
    },
    registeredUserStore: {
      findByTelegramId: async () => ({ user: { first_name: 'Saved', last_name: 'Original' } }),
      saveTelegramUser: async (record: RegisteredTelegramUserRecord) => {
        saved.push(record);
        return 'user';
      },
    },
    messageTemplateStore: { setUserBlocked: async () => {} },
    logger: { warn: () => {}, error: () => {} },
  } as unknown as BotDependencies;
  registerCommandHandlers(
    {
      command: (name: string, handler: (ctx: BotContext) => Promise<void>) => {
        commands[name] = handler;
      },
    } as unknown as Bot<BotContext>,
    dependencies,
  );
  const middleware = createMobileRegistrationMiddleware(dependencies);
  const ctx = {
    session,
    from: { id: 123, first_name: 'Display', last_name: 'Card', language_code: locale },
    chat: { id: 123, type: 'private' },
    message: {},
    reply: async (text: string, options: unknown) => {
      replies.push({ text, options });
    },
    answerCallbackQuery: async () => {},
  } as unknown as BotContext;
  const send = async (message: unknown) => {
    Object.assign(ctx, { message, callbackQuery: undefined });
    await middleware(ctx, async () => {
      if (ctx.message?.text?.startsWith('/start')) {
        ctx.match = ctx.message.text.split(' ').slice(1).join(' ');
        await commands.start?.(ctx);
      }
    });
  };
  return {
    ctx,
    session,
    dependencies,
    calls,
    saved,
    replies,
    middleware,
    send,
    contact: () =>
      send({
        contact: {
          user_id: 123,
          phone_number: '+998901234567',
          first_name: 'Contact',
          last_name: 'Display',
        },
      }),
    setResponse: (value: VerifyContactResult) => {
      response = value;
    },
    setStatus: (value: OtpSessionResponse | null) => {
      status = value;
    },
  };
};

describe('mobile profile name completion', () => {
  for (const locale of ['uz', 'ru'] as const) {
    for (const fields of [
      ['first_name', 'last_name'],
      ['first_name'],
      ['last_name'],
    ] as ProfileNameField[][]) {
      it(`${locale}: collects exactly ${fields.join(', ')} for new or linked incomplete users`, async () => {
        const h = setup(fields, locale);
        const deadline = h.session.otpAuth?.deadline;
        await h.contact();
        assert.equal(h.calls.length, 1);
        assert.equal(h.saved.length, 0);
        assert.equal(h.calls[0]?.first_name, undefined);
        assert.equal(h.calls[0]?.last_name, undefined);
        assert.equal(
          h.replies.at(-1)?.text,
          t(locale, fields[0] === 'first_name' ? 'otpFirstName' : 'otpLastName'),
        );
        h.setResponse({ success: true });
        for (const [index, field] of fields.entries()) {
          await h.send({ text: field === 'first_name' ? '  Али  ' : ' 王小明 ' });
          if (index < fields.length - 1) {
            assert.equal(h.calls.length, 1);
            assert.equal(h.session.otpAuth?.deadline, deadline);
          }
        }
        assert.equal(h.calls.length, 2);
        assert.deepEqual(h.calls[1], {
          ...h.calls[0],
          ...Object.fromEntries(
            fields.map((field) => [field, field === 'first_name' ? 'Али' : '王小明']),
          ),
        });
        assert.equal(h.session.otpAuth, undefined);
        assert.equal(h.session.stage, undefined);
        assert.equal(h.replies.at(-1)?.text, t(locale, 'otpSuccess'));
        assert.deepEqual(h.replies.at(-1)?.options, {
          parse_mode: 'HTML',
          reply_markup: { remove_keyboard: true },
        });
      });
    }
  }
  it('complete users receive no name prompt and saved names are preserved', async () => {
    const h = setup([]);
    await h.contact();
    assert.equal(h.calls.length, 1);
    assert.equal(h.replies.length, 1);
    assert.equal(h.saved[0]?.first_name, 'Saved');
    assert.equal(h.saved[0]?.last_name, 'Original');
  });
  it('stores explicit new-user names and supports 255 Unicode characters', async () => {
    const h = setup(['first_name', 'last_name']);
    h.dependencies.registeredUserStore.findByTelegramId = async () => null;
    await h.contact();
    await h.send({ text: '𐐀'.repeat(255) });
    h.setResponse({ success: true });
    await h.send({ text: '  Valiyev  ' });
    assert.equal(h.saved[0]?.first_name, '𐐀'.repeat(255));
    assert.equal(h.saved[0]?.last_name, 'Valiyev');
  });
  it('non-text input preserves the conversation even if status reads are unavailable', async () => {
    const h = setup(['last_name']);
    await h.contact();
    h.setStatus(null);
    await h.send({ photo: [] });
    assert.equal(h.session.stage, 'awaiting_otp_last_name');
    assert.equal(h.session.otpAuth?.verifiedContact?.contact_user_id, 123);
  });
  it('rejects whitespace, overlong, non-text, menu, skip and callback input without losing names', async () => {
    const h = setup(['first_name', 'last_name']);
    await h.contact();
    for (const message of [
      { text: '  \n ' },
      { text: 'a'.repeat(256) },
      { photo: [] },
      { text: t('uz', 'orders') },
      { text: t('ru', 'skipNote') },
      { text: '/help' },
    ]) {
      await h.send(message);
      assert.equal(h.session.stage, 'awaiting_otp_first_name');
      assert.equal(h.calls.length, 1);
    }
    let answered = false;
    Object.assign(h.ctx, {
      message: undefined,
      callbackQuery: { data: 'request:submit' },
      answerCallbackQuery: async () => {
        answered = true;
      },
    });
    await h.middleware(h.ctx, async () => {
      assert.fail('menu escaped gate');
    });
    assert.equal(answered, true);
    await h.send({ text: 'a'.repeat(255) });
    assert.equal(h.session.stage, 'awaiting_otp_last_name');
    await h.send({ sticker: {} });
    assert.equal(h.session.otpAuth?.names?.first_name?.length, 255);
  });
  it('ignores names and cancellation from a different sender/chat or a group', async () => {
    const h = setup(['first_name']);
    await h.contact();
    for (const [sender, chat, type] of [
      [124, 123, 'private'],
      [123, 124, 'private'],
      [123, 123, 'group'],
    ] as const) {
      Object.assign(h.ctx, { from: { id: sender }, chat: { id: chat, type } });
      await h.send({ text: 'Someone' });
      await h.send({ text: '/cancel' });
      assert.equal(h.calls.length, 1);
      assert.equal(h.session.stage, 'awaiting_otp_first_name');
    }
  });
  it('rejects typed phones and another person’s contact even for developers', async () => {
    const h = setup([]);
    h.session.developer = { is_active: true };
    await h.send({ text: '+998901234567' });
    await h.send({ contact: { user_id: 999, phone_number: '+998901234567' } });
    await h.send({ contact: { phone_number: '+998901234567' } });
    assert.equal(h.calls.length, 0);
  });
  it('preserves mismatch handling and requires another owned contact', async () => {
    const h = setup([]);
    h.setResponse({ success: false, error: 'PHONE_NUMBER_MISMATCH' });
    await h.contact();
    assert.equal(h.session.stage, 'awaiting_otp_contact');
    assert.equal(h.session.otpAuth?.verifiedContact, undefined);
    assert.equal(h.replies.at(-1)?.text, t('uz', 'otpPhoneMismatch'));
  });
  it('cancel clears pending state and normal handlers work afterward', async () => {
    const h = setup(['first_name']);
    await h.contact();
    await h.send({ text: '/cancel' });
    assert.equal(h.session.otpAuth, undefined);
    let normal = false;
    await h.middleware(h.ctx, async () => {
      normal = true;
    });
    assert.equal(normal, true);
    assert.equal(h.saved.length, 0);
  });
  it('a new start replaces names/contact, and restart recovers via an unexpired link', async () => {
    const h = setup(['first_name']);
    await h.contact();
    await h.send({ text: '/start sess_new' });
    assert.equal(h.session.otpAuth?.sessionToken, 'sess_new');
    assert.equal(h.session.otpAuth?.verifiedContact, undefined);
    assert.equal(h.session.otpAuth?.names, undefined);
    delete h.session.otpAuth;
    await h.send({ text: '/start sess_reopened' });
    assert.equal(h.session.stage, 'awaiting_otp_contact');
    assert.equal(h.saved.length, 0);
  });
  it('expires at the original local deadline and respects earlier backend expiration', async () => {
    for (const backendExpired of [true, false]) {
      const h = setup(['last_name']);
      await h.contact();
      if (backendExpired) h.setStatus(null);
      else if (h.session.otpAuth) h.session.otpAuth.deadline = Date.now() - 1;
      await h.send({ text: 'Late' });
      assert.equal(h.session.otpAuth, undefined);
      assert.equal(h.calls.length, 1);
    }
  });
  it('repeated missing-field responses resume with exactly the newly requested fields', async () => {
    const h = setup(['first_name', 'last_name']);
    await h.contact();
    await h.send({ text: 'Ali' });
    h.setResponse({
      success: false,
      error: 'PROFILE_NAMES_REQUIRED',
      missing_fields: ['last_name'],
    });
    await h.send({ text: 'Valiyev' });
    assert.equal(h.session.stage, 'awaiting_otp_last_name');
    h.setResponse({ success: true });
    await h.send({ text: 'Other surname' });
    assert.equal(h.calls[2]?.first_name, undefined);
    assert.equal(h.calls[2]?.last_name, 'Other surname');
  });
  it('service validation re-prompts the affected name without completing', async () => {
    const h = setup(['first_name']);
    await h.contact();
    h.setResponse({ success: false, error: 'INVALID_PROFILE_NAME', location: 'first_name' });
    await h.send({ text: 'Ali' });
    assert.equal(h.session.stage, 'awaiting_otp_first_name');
    assert.equal(h.session.otpAuth?.names?.first_name, undefined);
  });
  it('timeout reads back VERIFIED without repeating the POST', async () => {
    const h = setup(['first_name']);
    await h.contact();
    h.dependencies.otpAuthService!.verifyContact = async (params) => {
      h.calls.push(params);
      h.setStatus({ status: 'VERIFIED' });
      return { success: false, error: 'UNAVAILABLE' };
    };
    await h.send({ text: 'Ali' });
    assert.equal(h.calls.length, 2);
    assert.equal(h.session.otpAuth, undefined);
  });
  it('an ambiguous callback is never automatically retried; explicit retry first checks status', async () => {
    const h = setup([]);
    h.setResponse({ success: false, error: 'UNAVAILABLE' });
    await h.contact();
    assert.equal(h.calls.length, 1);
    assert.equal(h.session.otpAuth?.needsReadback, true);
    h.setStatus(null);
    await h.send({ text: 'check' });
    assert.equal(h.calls.length, 1);
    h.setStatus({ status: 'VERIFIED' });
    await h.send({ text: 'check' });
    assert.equal(h.calls.length, 1);
    assert.equal(h.session.otpAuth, undefined);
  });
  it('explicit retry with PENDING_TELEGRAM readback keeps the same contact and names', async () => {
    const h = setup(['last_name']);
    await h.contact();
    h.setResponse({ success: false, error: 'UNAVAILABLE' });
    await h.send({ text: 'Valiyev' });
    assert.equal(h.calls.length, 2);
    h.setResponse({ success: true });
    let readback = false;
    h.dependencies.otpAuthService!.getSession = async () => {
      readback = true;
      return { status: 'PENDING_TELEGRAM' };
    };
    h.dependencies.otpAuthService!.verifyContact = async (params) => {
      assert.equal(readback, true);
      h.calls.push(params);
      return { success: true };
    };
    await h.send({ text: 'check' });
    assert.deepEqual(h.calls[2], h.calls[1]);
    assert.equal(h.session.otpAuth, undefined);
  });
  it('does not log tokens, contact payloads or entered names in update/session summaries', async () => {
    const h = setup(['first_name']);
    await h.contact();
    h.session.otpAuth!.names = { first_name: 'SecretName' };
    Object.assign(h.ctx, { update: { update_id: 1 } });
    const log = JSON.stringify([summarizeSession(h.session), summarizeTelegramUpdate(h.ctx)]);
    for (const secret of ['sess_test', '+998901234567', 'SecretName', 'Contact', 'Display'])
      assert.equal(log.includes(secret), false);
  });
});
