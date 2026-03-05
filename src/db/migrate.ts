import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { getPool, closeDb } from './client';

async function migrate(): Promise<void> {
  const pool = getPool();
  const migrationsDir = join(__dirname, 'migrations');
  const files = readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log(`Running ${files.length} migration(s)...`);
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf-8');
    console.log(`  → ${file}`);
    await pool.query(sql);
  }
  console.log('Migrations complete.');

  await closeDb();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
