import { defineConfig } from 'vitest/config'

// Session F1 — minimal unit-test harness for pure logic that has no other test path in this
// repo: the audit-form engine (lib/audit-form.ts) and the Zustand audit-form store, both plain
// TS/JS with no DOM dependency. Scoped narrowly (test/**/*.test.ts under lib/stores), NOT a
// general component-testing setup — no jsdom, no React Testing Library. Mirrors the `@/*` path
// alias from tsconfig.json so test files can import exactly the way app code does.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/__tests__/**/*.test.ts', 'stores/**/__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': import.meta.dirname,
    },
  },
})
