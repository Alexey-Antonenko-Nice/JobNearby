import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, relative, isAbsolute } from "node:path";
import { createServer } from "node:net";
import type Database from "better-sqlite3";
import { createDatabase } from "../../src/infrastructure/database/createDatabase.js";
import { SqliteSourceObservationRepository } from "../../src/infrastructure/persistence/SqliteSourceObservationRepository.js";
import { browserCaptureFingerprint } from "../../src/application/acquisition/browserCaptureFingerprint.js";
import { scopePromanVacancyEvidence } from "../../src/application/evidence/scopePromanVacancyEvidence.js";
import { createVacancyEvidenceExtractor } from "../../src/application/evidence/createVacancyEvidenceExtractor.js";

// The CLI pins the real audit contract; these tests derive a contract ONLY from synthetic fixtures.
const tool = require("../../tools/remediate-proman.cjs");
const handles: Database.Database[] = [], directories: string[] = [];
const date = "2026-10-22T21:56:01.338Z";
const unrelatedProman = "f8cc9fee-08d8-45fc-8e3b-ef74ae9b044f";
let verify: (row: any) => Promise<void>;
beforeAll(async () => { verify = await tool.evidenceVerifier(); });
afterEach(() => {
  for (const db of handles.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0)) {
    const local = relative(tmpdir(), directory);
    if (!local || local.startsWith('..') || isAbsolute(local)) throw new Error('Refusing cleanup outside temporary workspace');
    rmSync(directory, { recursive: true, force: true });
  }
});
function fixture(file = ":memory:") {
  const db = createDatabase(file); handles.push(db);
  const html = '<nav>synthetic-private@example.invalid</nav><aside>' + 'SYNTHETIC_PRIVATE '.repeat(6000) + '</aside>';
  const insert = db.prepare(`INSERT INTO source_observations
    (id,source_type,source_name,source_url,observed_at,raw_content,metadata_json,content_fingerprint)
    VALUES (?,?,?,?,?,?,?,?)`);
  insert.run(tool.TARGET, 'BROWSER_CAPTURE', 'mon-espace.proman-emploi.fr', tool.URL, date,
    'synthetic-private@example.invalid +33 6 12 34 56 78',
    JSON.stringify({ acquisition: { html, pageTitle: 'SYNTHETIC_PRIVATE', metadata: { browser: 'SYNTHETIC_PRIVATE' } }, unknown: 'SYNTHETIC_PRIVATE' }), 'old-fingerprint');
  insert.run(unrelatedProman, 'BROWSER_CAPTURE', 'mon-espace.proman-emploi.fr', tool.URL, date, 'O2', '{}', 'O2-fingerprint');
  insert.run('other-provider', 'BROWSER_CAPTURE', 'example.invalid', 'https://example.invalid/job', date, 'Other', '{}', 'other-fingerprint');
  db.prepare('INSERT INTO canonical_vacancies VALUES (?,?,?,?,?,?,?)').run(tool.CANONICAL, 'PARTIAL', 'synthetic', '1', date, date, date);
  db.prepare('INSERT INTO canonical_vacancy_observation_claims VALUES (?,?)').run(tool.TARGET, tool.CANONICAL);
  db.prepare('INSERT INTO canonical_vacancy_source_observations VALUES (?,?,0)').run(tool.CANONICAL, tool.TARGET);
  db.prepare('INSERT INTO capture_occurrences VALUES (?,?,?,?)').run('occurrence-1', tool.TARGET, date, tool.URL);
  db.prepare('INSERT INTO employer_clusters (id,status,created_at,updated_at) VALUES (?,?,?,?)').run('cluster-1', 'UNRESOLVED', date, date);
  db.prepare(`INSERT INTO observation_cluster_assignments
    (id,source_observation_id,employer_cluster_id,confidence,status,algorithm,algorithm_version,evaluated_at,explanation)
    VALUES (?,?,?,?,?,?,?,?,?)`).run('assignment-1', tool.TARGET, 'cluster-1', 0, 'ACCEPTED', 'synthetic', '1', date, 'Synthetic safe history');
  return { db, expected: tool.expectation(db) };
}
function temporaryFile() {
  const directory = mkdtempSync(join(tmpdir(), 'proman-remediation-test-')); directories.push(directory);
  return join(directory, 'job-nearby.sqlite');
}
function target(db: Database.Database): any { return db.prepare('SELECT * FROM source_observations WHERE id=?').get(tool.TARGET); }

describe('one-time PROMAN historical payload remediation', () => {
  it('defaults to dry-run and rejects apply without stopped acknowledgement', () => {
    expect(tool.parseArgs([]).apply).toBe(false);
    expect(() => tool.parseArgs(['--apply'])).toThrow('confirm-stopped');
    expect(tool.parseArgs(['--apply', '--confirm-stopped']).apply).toBe(true);
  });
  it.each([['--id', 'other'], ['--database', 'other.sqlite'], ['--force'], ['--apply', '--apply']].map(args => ({ args })))('refuses target override/unknown CLI arguments $args', ({ args }) => {
    expect(() => tool.parseArgs(args)).toThrow();
  });
  it('dry-run performs zero writes and creates no sidecars or backup', () => {
    const file = temporaryFile(), { db, expected } = fixture(file); db.close();
    const before = readFileSync(file), snapshot = tool.readOnly(file);
    try {
      expect(tool.report(snapshot, expected).applyDataPreconditionsPass).toBe(true);
      expect(snapshot.prepare('SELECT total_changes() AS n').get()).toEqual({ n: 0 });
      expect(() => snapshot.exec('DELETE FROM source_observations')).toThrow();
    } finally { snapshot.close(); }
    expect(readFileSync(file)).toEqual(before);
    expect(tool.sidecars(file)).toEqual({ '-wal': null, '-shm': null, '-journal': null });
    expect(tool.diskSettings(file).journalMode).toBe('delete');
  });
  it('refuses when target ID is missing', () => {
    const { db, expected } = fixture(); db.pragma('foreign_keys=OFF');
    db.prepare('UPDATE source_observations SET id=? WHERE id=?').run('wrong-id', tool.TARGET);
    expect(() => tool.precheck(db, expected)).toThrow('Target missing');
  });
  it('never accepts a synthetic fixture under the pinned live audit contract', () => {
    const { db } = fixture(); expect(() => tool.precheck(db, tool.AUDITED)).toThrow();
  });
  it.each(['raw_content', 'content_fingerprint', 'metadata_json'])('refuses changed %s fingerprint', field => {
    const { db, expected } = fixture();
    db.prepare(`UPDATE source_observations SET ${field}=? WHERE id=?`).run(field === 'metadata_json' ? '{}' : 'changed', tool.TARGET);
    expect(() => tool.precheck(db, expected)).toThrow();
  });
  it('refuses unexpected canonical claim', () => {
    const { db, expected } = fixture();
    db.prepare('UPDATE canonical_vacancy_observation_claims SET canonical_vacancy_id=? WHERE source_observation_id=?').run('wrong-canonical', tool.TARGET);
    expect(() => tool.precheck(db, expected)).toThrow('Canonical claim');
  });
  it('refuses a new occurrence', () => {
    const { db, expected } = fixture();
    db.prepare('INSERT INTO capture_occurrences VALUES (?,?,?,?)').run('extra', tool.TARGET, date, tool.URL);
    expect(() => tool.precheck(db, expected)).toThrow('Occurrence');
  });
  it('refuses changed dependencies even when counts are identical', () => {
    const { db, expected } = fixture();
    db.prepare('UPDATE employer_clusters SET display_label=? WHERE id=?').run('Changed synthetic label', 'cluster-1');
    expect(() => tool.precheck(db, expected)).toThrow('dependencyHash');
  });
  it('refuses unexpected archive state', () => {
    const { db, expected } = fixture();
    db.prepare('INSERT INTO vacancy_cleanup_state VALUES (?,?,0)').run(tool.CANONICAL, date);
    expect(() => tool.precheck(db, expected)).toThrow('dependencyHash');
  });
  it('changes exactly one row and preserves every claim, occurrence, assignment, projection and unrelated observation', async () => {
    const { db, expected } = fixture(), before = tool.preservedState(db);
    const changes = (db.prepare('SELECT total_changes() AS n').get() as { n: number }).n;
    await tool.redact(db, expected, verify);
    expect((db.prepare('SELECT total_changes() AS n').get() as { n: number }).n - changes).toBe(1);
    expect(tool.preservedState(db)).toEqual(before);
    const r = target(db);
    expect(r.raw_content).toBe(''); expect(JSON.parse(r.metadata_json)).toEqual(JSON.parse(tool.METADATA));
    expect(r.content_fingerprint).toBeNull(); expect(r.external_id).toBeNull(); expect(r.source_url).toBe(tool.URL);
    expect(r.observed_at).toBe(date); expect(r.retired_at).toBeNull();
  });
  it('clears all optional page-derived fields and metadata poison', async () => {
    const { db } = fixture();
    db.prepare(`UPDATE source_observations SET title='poison',displayed_company_name='poison',location_text='poison',
      description='poison',salary_text='poison',contract_text='poison',contact_text='poison',provider_metadata_json='{}',published_at=? WHERE id=?`).run(date, tool.TARGET);
    const expected = tool.expectation(db); await tool.redact(db, expected, verify);
    for (const field of ['title','displayed_company_name','location_text','description','salary_text','contract_text','contact_text','provider_metadata_json','published_at']) expect(target(db)[field]).toBeNull();
    expect(target(db).metadata_json).not.toMatch(/poison|SYNTHETIC_PRIVATE/);
  });
  it('opts the shell out of deduplication against both original and empty future captures', async () => {
    const { db, expected } = fixture(); await tool.redact(db, expected, verify);
    const repository = new SqliteSourceObservationRepository(db);
    const shell = (await repository.findById(tool.TARGET))!;
    expect(shell.contentFingerprint).toBeUndefined();
    for (const [index, fingerprint] of ['old-fingerprint', browserCaptureFingerprint(shell)].entries()) {
      const fresh = { ...shell, id: `future-${index}`, contentFingerprint: fingerprint };
      expect(await repository.saveOrReuseBrowserSnapshot(fresh, { id: `future-occ-${index}`, capturedAt: new Date(date), capturedUrl: tool.URL }))
        .toEqual({ sourceObservationId: fresh.id, snapshotCreated: true });
    }
  });
  it('extracts no vacancy/person/organization evidence from redacted shell', async () => {
    const { db, expected } = fixture(); await tool.redact(db, expected, verify);
    const input = (await new SqliteSourceObservationRepository(db).findById(tool.TARGET))!;
    expect(scopePromanVacancyEvidence(input).rawContent).toBe('');
    const evidence = await createVacancyEvidenceExtractor().extract(input);
    for (const value of Object.values(evidence)) if (Array.isArray(value)) expect(value).toEqual([]);
  });
  it('rolls back the update if verification fails', async () => {
    const { db, expected } = fixture(), before = target(db), rest = tool.preservedState(db);
    await expect(tool.redact(db, expected, async () => { throw new Error('synthetic failure'); })).rejects.toThrow('synthetic failure');
    expect(target(db)).toEqual(before); expect(tool.preservedState(db)).toEqual(rest); expect(db.inTransaction).toBe(false);
  });
  it('rolls back unexpected trigger side effects', async () => {
    const { db } = fixture();
    db.exec(`CREATE TRIGGER synthetic_side_effect AFTER UPDATE ON source_observations WHEN NEW.id='${tool.TARGET}'
      BEGIN UPDATE source_observations SET raw_content='side effect' WHERE id='other-provider'; END;`);
    const expected = tool.expectation(db), before = target(db), rest = tool.preservedState(db);
    await expect(tool.redact(db, expected, verify)).rejects.toThrow('Non-target/history mutation');
    expect(target(db)).toEqual(before); expect(tool.preservedState(db)).toEqual(rest);
  });
  it('refuses second apply as already remediated', async () => {
    const { db, expected } = fixture(); await tool.redact(db, expected, verify);
    await expect(tool.redact(db, expected, verify)).rejects.toThrow('Already remediated');
    expect(db.inTransaction).toBe(false);
  });
  it.each(['-wal', '-shm', '-journal'])('refuses existing %s without touching it', suffix => {
    const file = temporaryFile(), { db } = fixture(file); db.close();
    writeFileSync(file + suffix, 'synthetic-sidecar');
    expect(() => tool.readOnly(file)).toThrow('WAL/SHM/journal');
    expect(readFileSync(file + suffix, 'utf8')).toBe('synthetic-sidecar');
  });
  it('refuses a listening application port', async () => {
    const server = createServer(); await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    try { await expect(tool.requireStoppedPort(address.port)).rejects.toThrow('listening'); }
    finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  it('refuses a database lock before backup or mutation', async () => {
    const file = temporaryFile(), { db, expected } = fixture(file);
    db.exec('BEGIN IMMEDIATE');
    const before = readFileSync(file), notices: unknown[] = [];
    try {
      await expect(tool.applyFile(file, expected, verify, tool.fileSummary(file), (notice: unknown) => notices.push(notice))).rejects.toThrow();
      expect(notices).toEqual([]); expect(readFileSync(file)).toEqual(before);
    } finally { db.exec('ROLLBACK'); }
  });
  it('refuses WAL mode instead of performing an unreviewed checkpoint or backup', async () => {
    const file = temporaryFile(), { db, expected } = fixture(file); db.pragma('journal_mode=WAL'); db.close();
    const before = readFileSync(file);
    expect(() => tool.diskSettings(file)).toThrow('WAL');
    await expect(tool.applyFile(file, expected, verify)).rejects.toThrow('WAL');
    expect(readFileSync(file)).toEqual(before);
  });
  it('backs up exact bytes, applies, compacts and verifies a synthetic file only', async () => {
    const file = temporaryFile(), { db, expected } = fixture(file); db.close();
    const before = readFileSync(file);
    const result = await tool.applyFile(file, expected, verify, tool.fileSummary(file), (notice: any) => directories.push(dirname(notice.backup.path)));
    expect(readFileSync(result.backup.path)).toEqual(before);
    expect(result.backup.sha256).toBe(tool.hash(before));
    expect(result.after.sha256).not.toBe(result.before.sha256);
    expect(result.after.bytes).toBeLessThanOrEqual(result.before.bytes);
    expect(result.sidecars).toEqual({ '-wal': null, '-shm': null, '-journal': null });
    expect(Object.values(result.targetPayloadPrivateMarkers)).toEqual([0, 0, 0, 0]);
    // Synthetic fixture sentinel only; never scan real private values.
    expect(readFileSync(file).includes(Buffer.from('SYNTHETIC_PRIVATE'))).toBe(false);
    const final = tool.readOnly(file);
    try { tool.integrity(final); expect(final.pragma('freelist_count', { simple: true })).toBe(0); }
    finally { final.close(); }
  });
});
