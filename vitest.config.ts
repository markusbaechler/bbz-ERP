import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    fileParallelism: false,
    hookTimeout: 30000,
    // Tests brauchen die DB-Verbindung; Fallback auf die lokale Docker-Postgres (docker-compose.yml).
    env: {
      DATABASE_URL: process.env.DATABASE_URL ?? 'postgres://bbz:bbz@localhost:5433/bbz_test',
    },
  },
});
