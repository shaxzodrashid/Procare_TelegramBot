import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normalizeUzPhone } from '../src/utils/phone.js';

describe('normalizeUzPhone', () => {
  it('normalizes all documented Uzbek formats', () => {
    for (const input of [
      '+998901234567',
      '998901234567',
      '901234567',
      '90 123 45 67',
      '(90) 123-45-67',
    ]) {
      assert.equal(normalizeUzPhone(input), '+998901234567');
    }
  });

  it('rejects malformed values', () => {
    assert.equal(normalizeUzPhone('123'), null);
    assert.equal(normalizeUzPhone(''), null);
    assert.equal(normalizeUzPhone('+997901234567'), null);
  });
});
