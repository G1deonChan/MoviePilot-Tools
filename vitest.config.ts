import { defineConfig } from 'vitest/config'

// 单元测试仅覆盖零 chrome 依赖的纯函数模块（core/crypto、utils/*），使用 node 环境
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
