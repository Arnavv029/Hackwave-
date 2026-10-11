import { execFileSync } from 'node:child_process';
import 'dotenv/config';

/**
 * Vitest global setup. When DB tests are enabled, apply migrations to the
 * test database before any test file runs. Unit tests never need this.
 */
export default function globalSetup(): void {
  if (process.env['RUN_DB_TESTS'] !== '1') return;

  const url = process.env['TEST_DATABASE_URL'];
  if (!url) {
    throw new Error('RUN_DB_TESTS=1 requires TEST_DATABASE_URL to be set');
  }
  if (url === process.env['DATABASE_URL']) {
    throw new Error('TEST_DATABASE_URL must differ from DATABASE_URL (tests truncate tables)');
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: url },
  });
}
