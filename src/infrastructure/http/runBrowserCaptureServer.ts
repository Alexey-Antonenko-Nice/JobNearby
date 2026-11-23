import { startJobNearbyServer } from "./startJobNearbyServer.js";

async function main(): Promise<void> {
  const runtime = await startJobNearbyServer({
    port: 4317,
    // The CLI server is the documented development backend for the Vite UI.
    developmentUiOrigins: ["http://127.0.0.1:5173"],
  });
  process.stdout.write(`Job Nearby browser capture listening at ${runtime.url}\n`);
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    void runtime.close().then(
      () => process.exit(0),
      error => {
        console.error("Job Nearby shutdown failed.", error);
        process.exit(1);
      },
    );
  };
  process.on("SIGINT", close);
  process.on("SIGTERM", close);
}

void main().catch(error => {
  console.error("Job Nearby server startup failed.", error);
  process.exitCode = 1;
});
