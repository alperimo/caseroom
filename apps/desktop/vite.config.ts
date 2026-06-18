import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@caseroom/simulation-core": fileURLToPath(
        new URL("../../packages/simulation-core/src/index.ts", import.meta.url),
      ),
      "@caseroom/case-packs-medical-osce": fileURLToPath(
        new URL("../../packages/case-packs/medical-osce/src/index.ts", import.meta.url),
      ),
      "@caseroom/qvac-runtime": fileURLToPath(
        new URL("../../packages/qvac-runtime/src/index.ts", import.meta.url),
      )
    }
  }
});
