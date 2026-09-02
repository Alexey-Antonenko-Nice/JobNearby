import { createDatabase } from "../database/createDatabase.js";
import { createCaptureProcessingRuntime } from "../runtime/createCaptureProcessingRuntime.js";
import { createVacancyReviewWorkflow } from "../../application/user/createVacancyReviewWorkflow.js";
import { SqliteCanonicalVacancyRepository } from "../persistence/SqliteCanonicalVacancyRepository.js";
import { SqliteSourceObservationRepository } from "../persistence/SqliteSourceObservationRepository.js";
import { SqliteEmployerClusterRepository } from "../persistence/SqliteEmployerClusterRepository.js";
import { SqliteEmployerMemoryPublicDataSource } from "../persistence/SqliteEmployerMemoryPublicDataSource.js";
import { SqliteUserVacancyInteractionRepository } from "../persistence/SqliteUserVacancyInteractionRepository.js";
import { createBrowserCaptureServer } from "./createBrowserCaptureServer.js";

const host = "127.0.0.1";
const port = 4317;
const database = createDatabase("job-nearby.sqlite");
const runtime = createCaptureProcessingRuntime(database, {
  onProcessingFailure: (sourceObservationId, error) => {
    console.error(`Vacancy processing failed for SourceObservation "${sourceObservationId}".`, error);
  },
});
const reviewWorkflow = createVacancyReviewWorkflow({
  canonicalVacancyRepository: new SqliteCanonicalVacancyRepository(database),
  sourceObservationRepository: new SqliteSourceObservationRepository(database),
  interactionRepository: new SqliteUserVacancyInteractionRepository(database),
  employerClusterRepository: new SqliteEmployerClusterRepository(database),
  employerMemoryPublicDataSource: new SqliteEmployerMemoryPublicDataSource(database),
});
const server = createBrowserCaptureServer({
  captureAndProcessBrowserVacancy: runtime.captureAndProcessBrowserVacancy,
  getVacancyInbox: reviewWorkflow.getVacancyInbox,
  getVacancyReview: reviewWorkflow.getVacancyReview,
  recordVacancyReviewAction: reviewWorkflow.recordVacancyReviewAction,
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
