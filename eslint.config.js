/**
 * Flat ESLint config.
 *
 * Two source trees with different worlds:
 * - `src/host` runs under Node: builtins and the filesystem are available.
 * - `src/client` runs in the browser inside the loader's closure factory: DOM
 *   globals exist, Node builtins must not.
 *
 * The config also enforces the package's one architectural rule: the client
 * bundle may import only `react` (a module-table row) and its own files. A
 * harness package import would need a specifier the loader cannot answer, so it
 * fails at runtime — catching it here is the point.
 */
import js from '@eslint/js'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default defineConfig(
  {
    // `.agents/` holds session-scoped agent worktrees: full checkouts of this
    // repository that would otherwise be linted a second time through the
    // outer project's tsconfig, which does not cover them.
    ignores: ['lib/', 'node_modules/', '*.tgz', 'coverage/', '.agents/'],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Config files sit outside every tsconfig `include`; they are linted
          // with the default project rather than their own type program.
          allowDefaultProject: ['eslint.config.js', 'tsdown.config.host.ts'],
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // The package ships JSDoc-documented public surfaces; a missing doc on an
      // internal helper is fine, but an `any` that erases a wire shape is not.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  // Host half: Node globals, and the harness context is reached structurally.
  {
    files: ['src/host/**/*.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Browser half: DOM globals, React hooks rules, no Node builtins.
  {
    files: ['src/client/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['node:*', '@deepseek-ai/*'],
              message:
                'The browser bundle resolves only platform modules (react) through the loader. ' +
                'Import shared types with `import type`, or reach behaviour through a cordis service.',
            },
          ],
        },
      ],
    },
  },

  // Tests and build scripts run under Node and may reach into either half.
  {
    files: ['tests/**/*.{ts,tsx}', 'scripts/**/*.ts', '*.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Test doubles are often deliberately async-shaped without awaiting.
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      'no-console': 'off',
    },
  },

  // Prettier owns formatting; this must stay last so it can disable conflicts.
  prettier,
)
