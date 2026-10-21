import { defineConfig } from 'vitest/config';
import { execSync } from 'child_process';

const commitHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
const commitTime = execSync('git log -1 --format=%ci', { encoding: 'utf-8' }).trim();

export default defineConfig({
  // Relative base so the build works at https://<user>.github.io/pooket-tabks/
  // (and anywhere else) without hardcoding the repo name.
  base: './',
  define: {
    __BUILD_VERSION__: JSON.stringify(`${commitHash.slice(0, 7)}`),
    __BUILD_TIME__: JSON.stringify(commitTime),
  },
  build: { target: 'es2022' },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
