import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    fileParallelism: false,
    coverage: {
      enabled: true,
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov'],
      include: ['src/*.ts', 'src/**/*.ts', '!src/index.ts'],
      exclude: [
        'src/infrastructure/adapters',
        'src/interfaces',
        '**/node_modules/**'
      ]
    },
    include: ['tests/*.ts', 'tests/**/*.ts'],
    exclude: ['**/node_modules/**', '**/test-helper-service.ts']
  }
});
