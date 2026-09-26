import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  // Only needed for the .tsx component tests — the 28 existing .ts route/lib
  // tests are plain Node and untouched by this. Without it, Vite's default
  // JSX handling in the SSR transform path used by vitest cannot parse a JSX
  // spread attribute (`{...props}`) at all — confirmed by hand: it fails on
  // that exact syntax with "Unexpected JSX expression" regardless of content,
  // not a symptom of anything else being wrong in the test file.
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    // The jsdom + React + Testing Library stack needed for the .tsx component
    // tests is heavy enough that vitest's default multi-file parallelism
    // exhausted memory on this machine outright (Zone Allocation failed / heap
    // OOM) even running just one file. Slower, but this environment has
    // confirmed, repeatable OOM at default settings — not a premature tune.
    // `singleFork`/`poolOptions.forks.singleFork` do not exist on Vitest 4's
    // InlineConfig at all (removed, not just relocated — confirmed against
    // node_modules/vitest/dist/chunks/config.d.*.d.ts); fileParallelism is the
    // actual replacement.
    fileParallelism: false,
    environment: "node",
    // .tsx included alongside .ts so component tests (jsx, environment
    // overridden per-file via a `// @vitest-environment jsdom` docblock) are
    // picked up too — added for tests/risk-compliance-client.test.tsx.
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
