import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts', 'src/api/index.ts', 'src/auth/index.ts', 'src/config/index.ts', 'src/ui/index.ts', 'src/output/index.ts', 'src/error/index.ts', 'src/environment/index.ts'],
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  splitting: false,
});
