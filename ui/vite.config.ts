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
    proxy: {
      ...Object.fromEntries(
        ["/vacancies", "/work-queue", "/contacts", "/documents", "/backup", "/export", "/extension"].map(path => [
          path,
          {
            target: "http://127.0.0.1:4317",
            changeOrigin: true,
            bypass: (request: import("node:http").IncomingMessage) =>
              request.headers.accept?.includes("text/html") &&
              ["/contacts", "/documents", "/backup", "/export"].includes(new URL(request.url ?? "/", "http://localhost").pathname)
                ? "/index.html"
                : undefined,
          },
        ]),
      ),
      // The dev bootstrap is an explicit development-only endpoint; the proxy adds
      // the configured dev origin so the server can apply its normal Origin policy.
      "/dev": {
        target: "http://127.0.0.1:4317",
        changeOrigin: true,
        headers: { Origin: "http://127.0.0.1:5173" },
      },
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});