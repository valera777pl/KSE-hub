import 'dotenv/config';
import * as path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL || 
  'postgresql://kse_hub:kse_hub_secret@localhost:5432/kse_hub';

// On Vercel every function instance opens its own pool, so keep it to one
// connection and skip prepared statements (Neon's pooler doesn't keep them).
const isServerless = !!process.env.VERCEL;

const queryClient = postgres(connectionString, {
  max: isServerless ? 1 : 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: !isServerless,
});

export const db = drizzle(queryClient, { schema });
export { queryClient };
