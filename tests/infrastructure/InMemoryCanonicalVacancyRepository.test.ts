import { InMemoryCanonicalVacancyRepository } from "../../src/infrastructure/persistence/InMemoryCanonicalVacancyRepository.js";
import { InMemorySourceObservationRepository } from "../../src/infrastructure/persistence/InMemorySourceObservationRepository.js";
import { runCanonicalVacancyRepositoryContract } from "../vacancies/CanonicalVacancyRepository.contract.js";

runCanonicalVacancyRepositoryContract("InMemory", () => {
  const sourceObservations = new InMemorySourceObservationRepository();
  return {
    repository: new InMemoryCanonicalVacancyRepository(sourceObservations),
    saveObservation: (observation) => sourceObservations.save(observation),
    close() {},
  };
});
