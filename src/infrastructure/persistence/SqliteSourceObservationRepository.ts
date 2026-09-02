import type Database from "better-sqlite3";

import type {
  SourceObservation,
  SourceObservationId,
} from "../../domain/capture/SourceObservation.js";

import type { SourceObservationRepository } from "../../domain/capture/SourceObservationRepository.js";
import type { BrowserCaptureOccurrence, BrowserCaptureSnapshotRepository } from "../../domain/capture/SourceObservationRepository.js";

import type {
  SourceReference,
  SourceType,
} from "../../domain/capture/SourceReference.js";

interface SourceObservationRow {
  id: string;

  source_type: string;
  source_name: string;
  source_url: string | null;
  external_id: string | null;
  provider_metadata_json: string | null;

  observed_at: string;
  published_at: string | null;

  title: string | null;
  displayed_company_name: string | null;
  location_text: string | null;
  description: string | null;
  salary_text: string | null;
  contract_text: string | null;
  contact_text: string | null;

  raw_content: string | null;
  metadata_json: string;
  content_fingerprint: string | null;
}

export class SqliteSourceObservationRepository
  implements BrowserCaptureSnapshotRepository
{
  constructor(private readonly db: Database.Database) {}

  async save(observation: SourceObservation): Promise<void> {
    const statement = this.db.prepare(`
      INSERT INTO source_observations (
        id,

        source_type,
        source_name,
        source_url,
        external_id,
        provider_metadata_json,

        observed_at,
        published_at,

        title,
        displayed_company_name,
        location_text,
        description,
        salary_text,
        contract_text,
        contact_text,

        raw_content,
        metadata_json,
        content_fingerprint
      )
      VALUES (
        @id,

        @source_type,
        @source_name,
        @source_url,
        @external_id,
        @provider_metadata_json,

        @observed_at,
        @published_at,

        @title,
        @displayed_company_name,
        @location_text,
        @description,
        @salary_text,
        @contract_text,
        @contact_text,

        @raw_content,
        @metadata_json,
        @content_fingerprint
      )
    `);

    try {
      statement.run({
        id: observation.id,

        source_type: observation.source.sourceType,
        source_name: observation.source.sourceName,
        source_url: observation.source.sourceUrl ?? null,
        external_id: observation.source.externalId ?? null,
        provider_metadata_json:
          observation.source.providerMetadata !== undefined
            ? JSON.stringify(observation.source.providerMetadata)
            : null,

        observed_at: observation.observedAt.toISOString(),
        published_at:
          observation.publishedAt !== undefined
            ? observation.publishedAt.toISOString()
            : null,

        title: observation.title ?? null,
        displayed_company_name:
          observation.displayedCompanyName ?? null,
        location_text: observation.locationText ?? null,
        description: observation.description ?? null,
        salary_text: observation.salaryText ?? null,
        contract_text: observation.contractText ?? null,
        contact_text: observation.contactText ?? null,

        raw_content: observation.rawContent ?? null,
        metadata_json: JSON.stringify(observation.metadata),
        content_fingerprint: observation.contentFingerprint ?? null,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new Error(
          `SourceObservation with id "${observation.id}" already exists.`,
        );
      }

      throw error;
    }
  }

  async findById(
    id: SourceObservationId,
  ): Promise<SourceObservation | null> {
    const row = this.db
      .prepare(`
        SELECT
          id,

          source_type,
          source_name,
          source_url,
          external_id,
          provider_metadata_json,

          observed_at,
          published_at,

          title,
          displayed_company_name,
          location_text,
          description,
          salary_text,
          contract_text,
          contact_text,

          raw_content,
          metadata_json,
          content_fingerprint

        FROM source_observations
        WHERE id = ?
      `)
      .get(id) as SourceObservationRow | undefined;

    if (row === undefined) {
      return null;
    }

    return mapRowToObservation(row);
  }

  async saveOrReuseBrowserSnapshot(
    observation: SourceObservation,
    occurrence: BrowserCaptureOccurrence,
  ): Promise<{ readonly sourceObservationId: string; readonly snapshotCreated: boolean }> {
    if (observation.source.externalId === undefined || observation.contentFingerprint === undefined) {
      await this.save(observation);
      this.insertOccurrence(observation.id, occurrence);
      return { sourceObservationId: observation.id, snapshotCreated: true };
    }
    const existing = this.findByIdentityAndFingerprint(
      observation.source.sourceName, observation.source.externalId, observation.contentFingerprint,
    );
    if (existing !== undefined) {
      this.insertOccurrence(existing, occurrence);
      return { sourceObservationId: existing, snapshotCreated: false };
    }
    try {
      await this.save(observation);
      this.insertOccurrence(observation.id, occurrence);
      return { sourceObservationId: observation.id, snapshotCreated: true };
    } catch (error) {
      const reused = this.findByIdentityAndFingerprint(
        observation.source.sourceName, observation.source.externalId, observation.contentFingerprint,
      );
      if (reused === undefined) throw error;
      this.insertOccurrence(reused, occurrence);
      return { sourceObservationId: reused, snapshotCreated: false };
    }
  }

  private findByIdentityAndFingerprint(sourceName: string, externalId: string, fingerprint: string): string | undefined {
    const row = this.db.prepare(`
      SELECT id FROM source_observations
      WHERE source_name = ? AND external_id = ? AND content_fingerprint = ?
    `).get(sourceName, externalId, fingerprint) as { id: string } | undefined;
    return row?.id;
  }

  private insertOccurrence(sourceObservationId: string, occurrence: BrowserCaptureOccurrence): void {
    this.db.prepare(`
      INSERT INTO capture_occurrences (id, source_observation_id, captured_at, captured_url)
      VALUES (?, ?, ?, ?)
    `).run(occurrence.id, sourceObservationId, occurrence.capturedAt.toISOString(), occurrence.capturedUrl);
  }
}

function mapRowToObservation(
  row: SourceObservationRow,
): SourceObservation {
  const source: SourceReference = {
    sourceType: row.source_type as SourceType,
    sourceName: row.source_name,

    ...(row.source_url !== null
      ? { sourceUrl: row.source_url }
      : {}),

    ...(row.external_id !== null
      ? { externalId: row.external_id }
      : {}),

    ...(row.provider_metadata_json !== null
      ? {
          providerMetadata: parseJsonObject(
            row.provider_metadata_json,
          ),
        }
      : {}),
  };

  return {
    id: row.id,
    source,

    observedAt: new Date(row.observed_at),

    ...(row.published_at !== null
      ? { publishedAt: new Date(row.published_at) }
      : {}),

    ...(row.content_fingerprint !== null ? { contentFingerprint: row.content_fingerprint } : {}),

    ...(row.title !== null
      ? { title: row.title }
      : {}),

    ...(row.displayed_company_name !== null
      ? {
          displayedCompanyName:
            row.displayed_company_name,
        }
      : {}),

    ...(row.location_text !== null
      ? { locationText: row.location_text }
      : {}),

    ...(row.description !== null
      ? { description: row.description }
      : {}),

    ...(row.salary_text !== null
      ? { salaryText: row.salary_text }
      : {}),

    ...(row.contract_text !== null
      ? { contractText: row.contract_text }
      : {}),

    ...(row.contact_text !== null
      ? { contactText: row.contact_text }
      : {}),

    ...(row.raw_content !== null
      ? { rawContent: row.raw_content }
      : {}),

    metadata: parseJsonObject(row.metadata_json),
  };
}

function parseJsonObject(
  value: string,
): Readonly<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(value);

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed)
  ) {
    throw new Error(
      "Stored JSON value is not an object.",
    );
  }

  return parsed as Readonly<Record<string, unknown>>;
}

function isUniqueConstraintError(
  error: unknown,
): boolean {
  return (
    error instanceof Error &&
    error.message.includes("UNIQUE constraint failed")
  );
}
