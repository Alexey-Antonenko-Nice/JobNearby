import { InMemoryObservationClusterAssignmentRepository } from "../../src/infrastructure/persistence/InMemoryObservationClusterAssignmentRepository.js";
import { runObservationClusterAssignmentRepositoryContract } from "../recognition/ObservationClusterAssignmentRepository.contract.js";

runObservationClusterAssignmentRepositoryContract("InMemory", () => ({
  repository: new InMemoryObservationClusterAssignmentRepository(),
  async prepare() {},
  close() {},
}));
