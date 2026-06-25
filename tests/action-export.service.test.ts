import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createActionExportWorkbook } from '../src/services/action-export.service.js';

const zipText = (buffer: Buffer): string => buffer.toString('utf8');

describe('action export workbook', () => {
  it('creates a multi-sheet XLSX package with escaped values', () => {
    const workbook = createActionExportWorkbook([
      {
        name: 'Users',
        headers: ['User ID', 'Name'],
        rows: [['1', 'Ali & Valiyev']],
      },
      {
        name: 'Message Dispatches',
        headers: ['Dispatch ID', 'Status'],
        rows: [['10', 'sent <ok>']],
      },
    ]);

    const text = zipText(workbook);
    assert.equal(workbook.subarray(0, 2).toString('utf8'), 'PK');
    assert.match(text, /xl\/workbook\.xml/);
    assert.match(text, /Users/);
    assert.match(text, /Message Dispatches/);
    assert.match(text, /Ali &amp; Valiyev/);
    assert.match(text, /sent &lt;ok&gt;/);
  });
});
