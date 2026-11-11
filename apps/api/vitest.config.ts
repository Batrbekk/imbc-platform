import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Интеграционные файлы пересоздают одну и ту же БД imbc_auth_test — только последовательно.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
