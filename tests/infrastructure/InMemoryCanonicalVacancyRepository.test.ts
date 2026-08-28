import { InMemoryCanonicalVacancyRepository } from "../../src/infrastructure/persistence/InMemoryCanonicalVacancyRepository.js";
import { runCanonicalVacancyRepositoryContract } from "../vacancies/CanonicalVacancyRepository.contract.js";

runCanonicalVacancyRepositoryContract("InMemory", () => ({
  repository: new InMemoryCanonicalVacancyRepository(),
  close() {},
}));
