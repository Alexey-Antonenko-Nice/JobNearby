import { fileURLToPath, URL } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(
      ["/vacancies", "/work-queue", "/contacts", "/documents", "/backup", "/export"].map(path => [
        path,
        {
          target: "http://127.0.0.1:4317",
          bypass: (request: import("node:http").IncomingMessage) =>
            request.headers.accept?.includes("text/html") &&
            ["/contacts", "/documents", "/backup", "/export"].includes(new URL(request.url ?? "/", "http://localhost").pathname)
              ? "/index.html"
              : undefined,
        },
      ]),
    ),
  },
  build: { outDir: "dist", emptyOutDir: true },
});