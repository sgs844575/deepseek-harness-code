import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 只跑本项目的单测；deepseek-harness 子树有自己独立的测试体系。
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
