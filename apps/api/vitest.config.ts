import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Integration files recreate their isolated auth/source database; serialize files sharing either runner.
    fileParallelism: !process.env.TEST_DATABASE_URL && !process.env.EONDIRIS_TEST_DATABASE_URL,
  },
});
