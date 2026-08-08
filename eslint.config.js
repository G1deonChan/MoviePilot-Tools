// ESLint 扁平配置（ESLint 9）：TypeScript + Vue3 <script setup>
import js from '@eslint/js'
import ts from 'typescript-eslint'
import vue from 'eslint-plugin-vue'
import globals from 'globals'

export default ts.config(
  {
    // 忽略产物与自动生成目录
    ignores: [
      '.output/**',
      '.wxt/**',
      'node_modules/**',
      'karpathy-guidelines__skillhub/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  // essential：仅保留防错规则，格式化风格交给编辑器/Prettier，避免噪音
  ...vue.configs['flat/essential'],
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node,
        __APP_VERSION__: 'readonly',
      },
      parserOptions: {
        // Vue SFC 中 <script lang="ts"> 用 ts 解析
        parser: ts.parser,
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    rules: {
      // 允许下划线前缀的未使用参数（如事件占位）
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // 组件名允许单词（视图/壳组件）
      'vue/multi-word-component-names': 'off',
    },
  },
)
