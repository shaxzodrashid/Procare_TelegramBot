import { loadConfig } from '../config/index.js';
import { createDatabase } from '../database/database.js';
import { PostgresRegisteredUserStore } from '../services/registered-user.store.js';
import type { RegisteredClientRecord } from '../types/registered-user.js';

const clientsToSeed: RegisteredClientRecord[] = [
  {
    telegram_id: '123456789',
    telegram_username: 'john_doe',
    first_name: 'John',
    last_name: 'Doe',
    phone_number: '+998901234567',
    locale: 'uz',
    crm_client_id: 'crm-client-john',
    customer_code: 'C001',
    status: 'Active',
    is_active: true,
  },
  {
    telegram_id: '987654321',
    telegram_username: 'jane_smith',
    first_name: 'Jane',
    last_name: 'Smith',
    phone_number: '+998912345678',
    locale: 'ru',
    crm_client_id: 'crm-client-jane',
    customer_code: 'C002',
    status: 'Active',
    is_active: true,
  },
  {
    telegram_id: '111222333',
    telegram_username: 'diyor_bek',
    first_name: 'Diyorbek',
    last_name: 'Rustamov',
    phone_number: '+998931112233',
    locale: 'uz',
    crm_client_id: 'crm-client-diyor',
    customer_code: 'C003',
    status: 'Active',
    is_active: true,
  },
];

async function main() {
  const config = loadConfig();
  const db = createDatabase(config.database);
  const store = new PostgresRegisteredUserStore(db);

  console.log('Seeding clients into database...');
  try {
    for (const client of clientsToSeed) {
      await store.saveClient(client);
      console.log(
        `Successfully seeded client: ${client.first_name} ${client.last_name || ''} (${client.phone_number})`,
      );
    }
    console.log('Seeding complete successfully!');
  } catch (error) {
    console.error('Error seeding clients:', error);
    process.exitCode = 1;
  } finally {
    await db.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
