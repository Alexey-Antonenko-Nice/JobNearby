import type { AcquisitionPackage } from "../../domain/acquisition/AcquisitionPackage.js";
import type {
  SourceObservation,
  SourceObservationId,
} from "../../domain/capture/SourceObservation.js";

export interface AcquisitionCaptureMapper {
  toSourceObservation(
    acquisition: AcquisitionPackage,
    observationId: SourceObservationId,
  ): SourceObservation;
}
