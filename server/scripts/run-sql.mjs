// Applies every src/db/sql/*.sql file in order. Each file must be idempotent.
// Used instead of `drizzle-kit push`, which misreads Postgres 18 NOT NULL constraints on Neon.
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

const dir = path.resolve(import.meta.dirname, '../src/db/sql');
const sql = postgres(process.env.DATABASE_URL, { max: 1, onnotice: () => {} });

for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  await sql.unsafe(fs.readFileSync(path.join(dir, file), 'utf8'));
  console.log(`applied ${file}`);
}
await sql.end();
