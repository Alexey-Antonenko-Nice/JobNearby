import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { SqliteEmployerClusterRepository } from "../../src/infrastructure/persistence/SqliteEmployerClusterRepository.js";
import { runEmployerClusterRepositoryContract } from "../recognition/EmployerClusterRepository.contract.js";

runEmployerClusterRepositoryContract("SQLite", () => {
  const db = createDatabase(":memory:");
  return {
    repository: new SqliteEmployerClusterRepository(db),
    close: () => db.close(),
  };
});
