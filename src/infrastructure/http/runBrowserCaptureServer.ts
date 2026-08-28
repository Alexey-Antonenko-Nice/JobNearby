import { DeterministicAcquisitionCaptureMapper } from "../../application/acquisition/DeterministicAcquisitionCaptureMapper.js";
import { createDatabase } from "../database/createDatabase.js";
import { SqliteSourceObservationRepository } from "../persistence/SqliteSourceObservationRepository.js";
import { createBrowserCaptureServer } from "./createBrowserCaptureServer.js";

const host = "127.0.0.1";
const port = 4317;
const database = createDatabase("job-nearby.sqlite");
const server = createBrowserCaptureServer({
  repository: new SqliteSourceObservationRepository(database),
  acquisitionMapper: new DeterministicAcquisitionCaptureMapper(),
});

server.listen(port, host, () => {
  process.stdout.write(`Job Nearby browser capture listening at http://${host}:${port}\n`);
});

function close(): void {
  server.close(() => {
    database.close();
    process.exit(0);
  });
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
