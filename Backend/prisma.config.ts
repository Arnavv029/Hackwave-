// Prisma 7 configuration. The datasource URL lives here (not in schema.prisma).
// Prisma does not load .env on its own, so we load it explicitly.
import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // DATABASE_URL is validated by src/config/env.ts at runtime; here we only
    // pass it through so the CLI (migrate/studio) can reach the database.
    url: process.env['DATABASE_URL'],
  },
});
