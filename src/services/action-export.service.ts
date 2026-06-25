import type { Knex } from 'knex';

export interface ActionExportPeriod {
  from: Date;
  toExclusive: Date;
  fromLabel: string;
  toLabel: string;
}

export interface ActionExportResult {
  fileName: string;
  buffer: Buffer;
  rowCounts: Record<string, number>;
}

export interface ActionExportService {
  exportActions(period: ActionExportPeriod): Promise<ActionExportResult>;
}

type CellValue = string | number | boolean | Date | null | undefined;

interface WorkbookSheet {
  name: string;
  headers: string[];
  rows: CellValue[][];
}

const crcTable = (() => {
  const table: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (buffer: Buffer): number => {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
};

const xmlEscape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const columnName = (index: number): string => {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
};

const cellText = (value: CellValue): string => {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
};

const worksheetXml = (sheet: WorkbookSheet): string => {
  const allRows = [sheet.headers, ...sheet.rows];
  const maxColumns = Math.max(sheet.headers.length, ...sheet.rows.map((row) => row.length), 1);
  const columns = Array.from({ length: maxColumns }, (_, index) => {
    const width = Math.min(
      45,
      Math.max(
        12,
        ...allRows.map((row) => {
          const value = cellText(row[index]);
          return Math.min(45, value.length + 2);
        }),
      ),
    );
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join('');

  const rows = allRows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = Array.from({ length: maxColumns }, (_, columnIndex) => {
        const ref = `${columnName(columnIndex)}${rowNumber}`;
        const value = xmlEscape(cellText(row[columnIndex]));
        return `<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
      }).join('');
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join('');

  const dimension = `${columnName(0)}1:${columnName(maxColumns - 1)}${Math.max(allRows.length, 1)}`;
  const autoFilter =
    allRows.length > 1
      ? `<autoFilter ref="${columnName(0)}1:${columnName(maxColumns - 1)}1"/>`
      : '';

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
    `<dimension ref="${dimension}"/>`,
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    '<sheetFormatPr defaultRowHeight="15"/>',
    `<cols>${columns}</cols>`,
    `<sheetData>${rows}</sheetData>`,
    autoFilter,
    '</worksheet>',
  ].join('');
};

const workbookXml = (sheets: WorkbookSheet[]): string => {
  const sheetElements = sheets
    .map(
      (sheet, index) =>
        `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('');

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
    `<sheets>${sheetElements}</sheets>`,
    '</workbook>',
  ].join('');
};

const workbookRelationshipsXml = (sheets: WorkbookSheet[]): string => {
  const worksheetRels = sheets
    .map(
      (_sheet, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('');
  const stylesRel = `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
    worksheetRels,
    stylesRel,
    '</Relationships>',
  ].join('');
};

const contentTypesXml = (sheets: WorkbookSheet[]): string => {
  const worksheetOverrides = sheets
    .map(
      (_sheet, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('');

  return [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
    '<Default Extension="xml" ContentType="application/xml"/>',
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>',
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>',
    worksheetOverrides,
    '</Types>',
  ].join('');
};

const rootRelationshipsXml = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
  '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>',
  '</Relationships>',
].join('');

const stylesXml = [
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
  '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>',
  '<fills count="1"><fill><patternFill patternType="none"/></fill></fills>',
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>',
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>',
  '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>',
  '</styleSheet>',
].join('');

interface ZipEntry {
  name: string;
  content: Buffer;
}

const makeZip = (entries: ZipEntry[]): Buffer => {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8');
    const content = entry.content;
    const crc = crc32(content);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0x0800, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(content.length, 18);
    localHeader.writeUInt32LE(content.length, 22);
    localHeader.writeUInt16LE(name.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, name, content);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0x0800, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(content.length, 20);
    centralHeader.writeUInt32LE(content.length, 24);
    centralHeader.writeUInt16LE(name.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, name);

    offset += localHeader.length + name.length + content.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
};

export const createActionExportWorkbook = (sheets: WorkbookSheet[]): Buffer => {
  const entries: ZipEntry[] = [
    { name: '[Content_Types].xml', content: Buffer.from(contentTypesXml(sheets), 'utf8') },
    { name: '_rels/.rels', content: Buffer.from(rootRelationshipsXml, 'utf8') },
    { name: 'xl/workbook.xml', content: Buffer.from(workbookXml(sheets), 'utf8') },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: Buffer.from(workbookRelationshipsXml(sheets), 'utf8'),
    },
    { name: 'xl/styles.xml', content: Buffer.from(stylesXml, 'utf8') },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      content: Buffer.from(worksheetXml(sheet), 'utf8'),
    })),
  ];

  return makeZip(entries);
};

const iso = (value: unknown): string => {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return '';
  return String(value);
};

const rowValue = (row: Record<string, unknown>, key: string): CellValue => row[key] as CellValue;

const rangeWhere = (query: Knex.QueryBuilder, column: string, period: ActionExportPeriod): void => {
  query.where(column, '>=', period.from).andWhere(column, '<', period.toExclusive);
};

export class PostgresActionExportService implements ActionExportService {
  constructor(private readonly database: Knex) {}

  async exportActions(period: ActionExportPeriod): Promise<ActionExportResult> {
    const [
      users,
      clientRegistrations,
      employeeRegistrations,
      messageTemplates,
      dispatchLogs,
      supportMessages,
      unknownClientDeclines,
    ] = await Promise.all([
      this.loadUsers(),
      this.loadClientRegistrations(period),
      this.loadEmployeeRegistrations(period),
      this.loadMessageTemplates(period),
      this.loadDispatchLogs(period),
      this.loadSupportMessages(period),
      this.loadUnknownClientDeclines(period),
    ]);

    const sheets: WorkbookSheet[] = [
      users,
      clientRegistrations,
      employeeRegistrations,
      messageTemplates,
      dispatchLogs,
      supportMessages,
      unknownClientDeclines,
    ];

    return {
      fileName: `procare-actions_${period.fromLabel}_to_${period.toLabel}.xlsx`,
      buffer: createActionExportWorkbook(sheets),
      rowCounts: Object.fromEntries(sheets.map((sheet) => [sheet.name, sheet.rows.length])),
    };
  }

  private async loadUsers(): Promise<WorkbookSheet> {
    const rows = (await this.database('users')
      .leftJoin('clients', 'users.id', 'clients.user_id')
      .leftJoin('employees', 'users.id', 'employees.user_id')
      .select({
        user_id: 'users.id',
        telegram_id: 'users.telegram_id',
        telegram_username: 'users.telegram_username',
        first_name: 'users.first_name',
        last_name: 'users.last_name',
        phone_number: 'users.phone_number',
        language_code: 'users.language_code',
        is_blocked: 'users.is_blocked',
        last_decline_reason: 'users.last_decline_reason',
        declined_at: 'users.declined_at',
        user_created_at: 'users.created_at',
        user_updated_at: 'users.updated_at',
        crm_client_id: 'clients.crm_client_id',
        customer_code: 'clients.customer_code',
        client_status: 'clients.status',
        client_is_active: 'clients.is_active',
        crm_admin_id: 'employees.crm_admin_id',
        employee_status: 'employees.status',
        employee_is_active: 'employees.is_active',
      })
      .orderBy('users.created_at', 'asc')) as Record<string, unknown>[];

    return {
      name: 'Users',
      headers: [
        'User ID',
        'Telegram ID',
        'Username',
        'First name',
        'Last name',
        'Phone number',
        'Language',
        'Blocked',
        'Last decline reason',
        'Declined at',
        'User created at',
        'User updated at',
        'CRM client ID',
        'Customer code',
        'Client status',
        'Client active',
        'CRM admin ID',
        'Employee status',
        'Employee active',
      ],
      rows: rows.map((row) => [
        rowValue(row, 'user_id'),
        rowValue(row, 'telegram_id'),
        rowValue(row, 'telegram_username'),
        rowValue(row, 'first_name'),
        rowValue(row, 'last_name'),
        rowValue(row, 'phone_number'),
        rowValue(row, 'language_code'),
        rowValue(row, 'is_blocked'),
        rowValue(row, 'last_decline_reason'),
        iso(row.declined_at),
        iso(row.user_created_at),
        iso(row.user_updated_at),
        rowValue(row, 'crm_client_id'),
        rowValue(row, 'customer_code'),
        rowValue(row, 'client_status'),
        rowValue(row, 'client_is_active'),
        rowValue(row, 'crm_admin_id'),
        rowValue(row, 'employee_status'),
        rowValue(row, 'employee_is_active'),
      ]),
    };
  }

  private async loadClientRegistrations(period: ActionExportPeriod): Promise<WorkbookSheet> {
    const query = this.database('clients')
      .join('users', 'clients.user_id', 'users.id')
      .select({
        client_id: 'clients.id',
        user_id: 'users.id',
        telegram_id: 'users.telegram_id',
        first_name: 'users.first_name',
        last_name: 'users.last_name',
        phone_number: 'users.phone_number',
        crm_client_id: 'clients.crm_client_id',
        customer_code: 'clients.customer_code',
        status: 'clients.status',
        is_active: 'clients.is_active',
        created_at: 'clients.created_at',
        updated_at: 'clients.updated_at',
      })
      .orderBy('clients.created_at', 'asc');
    rangeWhere(query, 'clients.created_at', period);
    const rows = (await query) as Record<string, unknown>[];

    return {
      name: 'Client Registrations',
      headers: [
        'Client row ID',
        'User ID',
        'Telegram ID',
        'First name',
        'Last name',
        'Phone number',
        'CRM client ID',
        'Customer code',
        'Status',
        'Active',
        'Created at',
        'Updated at',
      ],
      rows: rows.map((row) => [
        rowValue(row, 'client_id'),
        rowValue(row, 'user_id'),
        rowValue(row, 'telegram_id'),
        rowValue(row, 'first_name'),
        rowValue(row, 'last_name'),
        rowValue(row, 'phone_number'),
        rowValue(row, 'crm_client_id'),
        rowValue(row, 'customer_code'),
        rowValue(row, 'status'),
        rowValue(row, 'is_active'),
        iso(row.created_at),
        iso(row.updated_at),
      ]),
    };
  }

  private async loadEmployeeRegistrations(period: ActionExportPeriod): Promise<WorkbookSheet> {
    const query = this.database('employees')
      .join('users', 'employees.user_id', 'users.id')
      .select({
        employee_id: 'employees.id',
        user_id: 'users.id',
        telegram_id: 'users.telegram_id',
        first_name: 'users.first_name',
        last_name: 'users.last_name',
        phone_number: 'users.phone_number',
        crm_admin_id: 'employees.crm_admin_id',
        status: 'employees.status',
        is_active: 'employees.is_active',
        created_at: 'employees.created_at',
        updated_at: 'employees.updated_at',
      })
      .orderBy('employees.created_at', 'asc');
    rangeWhere(query, 'employees.created_at', period);
    const rows = (await query) as Record<string, unknown>[];

    return {
      name: 'Employee Registrations',
      headers: [
        'Employee row ID',
        'User ID',
        'Telegram ID',
        'First name',
        'Last name',
        'Phone number',
        'CRM admin ID',
        'Status',
        'Active',
        'Created at',
        'Updated at',
      ],
      rows: rows.map((row) => [
        rowValue(row, 'employee_id'),
        rowValue(row, 'user_id'),
        rowValue(row, 'telegram_id'),
        rowValue(row, 'first_name'),
        rowValue(row, 'last_name'),
        rowValue(row, 'phone_number'),
        rowValue(row, 'crm_admin_id'),
        rowValue(row, 'status'),
        rowValue(row, 'is_active'),
        iso(row.created_at),
        iso(row.updated_at),
      ]),
    };
  }

  private async loadMessageTemplates(period: ActionExportPeriod): Promise<WorkbookSheet> {
    const rows = (await this.database('message_templates')
      .select({
        template_id: 'id',
        template_key: 'template_key',
        template_type: 'template_type',
        title: 'title',
        channel: 'channel',
        is_active: 'is_active',
        created_at: 'created_at',
        updated_at: 'updated_at',
      })
      .where((query) => {
        query
          .where((created) => rangeWhere(created, 'created_at', period))
          .orWhere((updated) => rangeWhere(updated, 'updated_at', period));
      })
      .orderBy('updated_at', 'asc')) as Record<string, unknown>[];

    return {
      name: 'Message Templates',
      headers: [
        'Template ID',
        'Template key',
        'Template type',
        'Title',
        'Channel',
        'Active',
        'Created at',
        'Updated at',
      ],
      rows: rows.map((row) => [
        rowValue(row, 'template_id'),
        rowValue(row, 'template_key'),
        rowValue(row, 'template_type'),
        rowValue(row, 'title'),
        rowValue(row, 'channel'),
        rowValue(row, 'is_active'),
        iso(row.created_at),
        iso(row.updated_at),
      ]),
    };
  }

  private async loadDispatchLogs(period: ActionExportPeriod): Promise<WorkbookSheet> {
    const query = this.database('message_dispatch_logs')
      .leftJoin('users', 'message_dispatch_logs.user_id', 'users.id')
      .leftJoin('message_templates', 'message_dispatch_logs.template_id', 'message_templates.id')
      .select({
        dispatch_id: 'message_dispatch_logs.id',
        user_id: 'message_dispatch_logs.user_id',
        telegram_id: 'users.telegram_id',
        phone_number: 'users.phone_number',
        template_id: 'message_dispatch_logs.template_id',
        template_key: 'message_templates.template_key',
        template_type: 'message_templates.template_type',
        dispatch_type: 'message_dispatch_logs.dispatch_type',
        status: 'message_dispatch_logs.status',
        error_message: 'message_dispatch_logs.error_message',
        created_at: 'message_dispatch_logs.created_at',
      })
      .orderBy('message_dispatch_logs.created_at', 'asc');
    rangeWhere(query, 'message_dispatch_logs.created_at', period);
    const rows = (await query) as Record<string, unknown>[];

    return {
      name: 'Message Dispatches',
      headers: [
        'Dispatch ID',
        'User ID',
        'Telegram ID',
        'Phone number',
        'Template ID',
        'Template key',
        'Template type',
        'Dispatch type',
        'Status',
        'Error message',
        'Created at',
      ],
      rows: rows.map((row) => [
        rowValue(row, 'dispatch_id'),
        rowValue(row, 'user_id'),
        rowValue(row, 'telegram_id'),
        rowValue(row, 'phone_number'),
        rowValue(row, 'template_id'),
        rowValue(row, 'template_key'),
        rowValue(row, 'template_type'),
        rowValue(row, 'dispatch_type'),
        rowValue(row, 'status'),
        rowValue(row, 'error_message'),
        iso(row.created_at),
      ]),
    };
  }

  private async loadSupportMessages(period: ActionExportPeriod): Promise<WorkbookSheet> {
    const query = this.database('support_messages')
      .leftJoin('users', 'support_messages.user_id', 'users.id')
      .select({
        support_message_id: 'support_messages.id',
        crm_comment_id: 'support_messages.crm_comment_id',
        crm_client_id: 'support_messages.crm_client_id',
        repair_order_id: 'support_messages.repair_order_id',
        order_number: 'support_messages.order_number',
        user_id: 'support_messages.user_id',
        user_phone_number: 'users.phone_number',
        telegram_id: 'support_messages.telegram_id',
        telegram_chat_id: 'support_messages.telegram_chat_id',
        telegram_message_id: 'support_messages.telegram_message_id',
        telegram_message_date: 'support_messages.telegram_message_date',
        sender_type: 'support_messages.sender_type',
        direction: 'support_messages.direction',
        content_type: 'support_messages.content_type',
        text: 'support_messages.text',
        photo_count: 'support_messages.photo_count',
        reply_to_support_message_id: 'support_messages.reply_to_support_message_id',
        created_at: 'support_messages.created_at',
        updated_at: 'support_messages.updated_at',
      })
      .orderBy('support_messages.created_at', 'asc');
    rangeWhere(query, 'support_messages.created_at', period);
    const rows = (await query) as Record<string, unknown>[];

    return {
      name: 'Support Messages',
      headers: [
        'Support message ID',
        'CRM comment ID',
        'CRM client ID',
        'Repair order ID',
        'Order number',
        'User ID',
        'User phone number',
        'Telegram ID',
        'Telegram chat ID',
        'Telegram message ID',
        'Telegram message date',
        'Sender type',
        'Direction',
        'Content type',
        'Text',
        'Photo count',
        'Reply to support message ID',
        'Created at',
        'Updated at',
      ],
      rows: rows.map((row) => [
        rowValue(row, 'support_message_id'),
        rowValue(row, 'crm_comment_id'),
        rowValue(row, 'crm_client_id'),
        rowValue(row, 'repair_order_id'),
        rowValue(row, 'order_number'),
        rowValue(row, 'user_id'),
        rowValue(row, 'user_phone_number'),
        rowValue(row, 'telegram_id'),
        rowValue(row, 'telegram_chat_id'),
        rowValue(row, 'telegram_message_id'),
        iso(row.telegram_message_date),
        rowValue(row, 'sender_type'),
        rowValue(row, 'direction'),
        rowValue(row, 'content_type'),
        rowValue(row, 'text'),
        rowValue(row, 'photo_count'),
        rowValue(row, 'reply_to_support_message_id'),
        iso(row.created_at),
        iso(row.updated_at),
      ]),
    };
  }

  private async loadUnknownClientDeclines(period: ActionExportPeriod): Promise<WorkbookSheet> {
    const rows = (await this.database('users')
      .select({
        user_id: 'id',
        telegram_id: 'telegram_id',
        telegram_username: 'telegram_username',
        first_name: 'first_name',
        last_name: 'last_name',
        phone_number: 'phone_number',
        language_code: 'language_code',
        decline_reason: 'last_decline_reason',
        declined_at: 'declined_at',
        created_at: 'created_at',
        updated_at: 'updated_at',
      })
      .whereNotNull('last_decline_reason')
      .whereNotNull('declined_at')
      .where('declined_at', '>=', period.from)
      .andWhere('declined_at', '<', period.toExclusive)
      .orderBy('declined_at', 'asc')) as Record<string, unknown>[];

    return {
      name: 'Unknown Client Declines',
      headers: [
        'User ID',
        'Telegram ID',
        'Username',
        'First name',
        'Last name',
        'Phone number',
        'Language',
        'Decline reason',
        'Declined at',
        'Created at',
        'Updated at',
      ],
      rows: rows.map((row) => [
        rowValue(row, 'user_id'),
        rowValue(row, 'telegram_id'),
        rowValue(row, 'telegram_username'),
        rowValue(row, 'first_name'),
        rowValue(row, 'last_name'),
        rowValue(row, 'phone_number'),
        rowValue(row, 'language_code'),
        rowValue(row, 'decline_reason'),
        iso(row.declined_at),
        iso(row.created_at),
        iso(row.updated_at),
      ]),
    };
  }
}
