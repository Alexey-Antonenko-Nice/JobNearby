#!/usr/bin/env node
'use strict';
// One-time M15.2 tool. No imports from the application server or migration runner.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const net = require('node:net');
const Database = require('better-sqlite3');

const TARGET = 'bd9d0305-91c8-44ca-b52f-ef428b3de259';
const CANONICAL = 'eedd27e8-f828-4538-bc45-1e7ad7061541';
const URL = 'https://mon-espace.proman-emploi.fr/dashboard?offre_id=1197787';
const ROOT = path.resolve(__dirname, '..');
const LIVE = path.join(ROOT, 'job-nearby.sqlite');
const CLEARED = ['provider_metadata_json', 'published_at', 'title', 'displayed_company_name',
  'location_text', 'description', 'salary_text', 'contract_text', 'contact_text'];
const METADATA = JSON.stringify({ acquisition: { html: '', contexts: [], metadata: {
  vacancyEvidenceScope: 'SELECTED_VACANCY_REQUIRED', historicalPayloadRedacted: true,
  redactionReason: 'PROMAN_AUTHENTICATED_DASHBOARD_PRIVACY',
} } });
// Pinned from the read-only audit; never derived from the current row at CLI apply time.
const AUDITED = {
  "rowHash": "3f80637852cbae355047375ff99aee29133fa2e3a437e5ba371c5e24e50654b6",
  "dependencyHash": "ae570e8a77a9e86edb3f27b588458b60ac64b5ce50defe51307ce886eefacebc",
  "schemaHash": "126ebe515409219d352bada7638dde1202016a662d247509de352cac0ced603d",
  "rawLength": 1273,
  "htmlLength": 93730,
  "rawHash": "435a8fb510d1d0348f1c4b9d0cd60421b9bbdf27f4c0e3e9d92631c7f2592d5e",
  "htmlHash": "a80d36d50eeff00d63a84816eb4a0b62b58551a6148d0546e3581438e29aed57",
  "counts": {
    "canonical_vacancies": 1,
    "canonical_vacancy_alternative_evidence": 0,
    "canonical_vacancy_evidence_references": 5,
    "canonical_vacancy_exact_identity_claims": 0,
    "canonical_vacancy_field_alternatives": 0,
    "canonical_vacancy_field_evidence": 3,
    "canonical_vacancy_fields": 16,
    "canonical_vacancy_observation_claims": 1,
    "canonical_vacancy_organization_evidence": 2,
    "canonical_vacancy_organization_relationships": 2,
    "canonical_vacancy_source_observations": 1,
    "capture_occurrences": 1,
    "confirmed_organization_roles": 0,
    "employer_alias_evidence": 0,
    "employer_clusters": 1,
    "observation_cluster_assignments": 1,
    "publication_family_memberships": 0,
    "recruitment_campaign_memberships": 0,
    "shared_employer_source_evidence": 0,
    "user_vacancy_interaction_events": 0,
    "vacancy_cleanup_guard": 0,
    "vacancy_cleanup_source_guard": 0,
    "vacancy_cleanup_state": 0,
    "vacancy_organization_role_decisions": 0
  }
};
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const stable = value => JSON.stringify(value, (_key, v) => v && typeof v === 'object' && !Array.isArray(v)
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
const digest = value => hash(stable(value));
const quote = name => '"' + name.replaceAll('"', '""') + '"';
class SafeError extends Error {}
function insist(ok, category) { if (!ok) throw new SafeError(category); }
function row(db) { return db.prepare('SELECT * FROM source_observations WHERE id = ?').get(TARGET); }
function tables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r => r.name);
}
function schemaHash(db) {
  return digest(db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all());
}
function dependencies(db) {
  const result = {};
  const assignments = db.prepare('SELECT * FROM observation_cluster_assignments WHERE source_observation_id=?').all(TARGET);
  const assignmentIds = assignments.map(r => r.id);
  const clusterIds = assignments.map(r => r.employer_cluster_id);
  for (const table of tables(db)) {
    if (table === 'source_observations') continue;
    const columns = db.prepare(`PRAGMA table_info(${quote(table)})`).all().map(r => r.name);
    const predicates = [], values = [];
    for (const column of columns) {
      let ids;
      if (column === 'source_observation_id') ids = [TARGET];
      if (column === 'canonical_vacancy_id' || column === 'source_vacancy_id') ids = [CANONICAL];
      if (column === 'source_assignment_id') ids = assignmentIds;
      if (table === 'canonical_vacancies' && column === 'id') ids = [CANONICAL];
      if (table === 'employer_clusters' && column === 'id') ids = clusterIds;
      if (ids?.length) { predicates.push(`${quote(column)} IN (${ids.map(() => '?').join(',')})`); values.push(...ids); }
    }
    if (predicates.length) result[table] = db.prepare(`SELECT * FROM ${quote(table)} WHERE ${predicates.join(' OR ')}`).all(...values).map(stable).sort();
  }
  return result;
}
function expectation(db) {
  const r = row(db); insist(r, 'Target missing');
  const a = JSON.parse(r.metadata_json).acquisition;
  const deps = dependencies(db);
  return { rowHash: digest(r), dependencyHash: digest(deps), schemaHash: schemaHash(db),
    rawLength: r.raw_content?.length ?? 0, htmlLength: a?.html?.length ?? 0,
    rawHash: hash(r.raw_content ?? ''), htmlHash: hash(a?.html ?? ''),
    counts: Object.fromEntries(Object.entries(deps).map(([t, rows]) => [t, rows.length])) };
}
function precheck(db, expected) {
  const r = row(db); insist(r, 'Target missing');
  insist(r.source_name === 'mon-espace.proman-emploi.fr' && r.source_url === URL && r.external_id === null
    && r.retired_at === null, 'Identity/state mismatch');
  insist(r.metadata_json !== METADATA, 'Already remediated');
  const claims = db.prepare('SELECT canonical_vacancy_id FROM canonical_vacancy_observation_claims WHERE source_observation_id=?').all(TARGET);
  insist(claims.length === 1 && claims[0].canonical_vacancy_id === CANONICAL, 'Canonical claim mismatch');
  const a = JSON.parse(r.metadata_json).acquisition;
  insist(a && typeof a.html === 'string' && typeof a.pageTitle === 'string' && a.contexts === undefined,
    'Acquisition structure mismatch');
  insist(db.prepare('SELECT count(*) AS n FROM capture_occurrences WHERE source_observation_id=?').get(TARGET).n === 1,
    'Occurrence count mismatch');
  const actual = expectation(db);
  for (const key of Object.keys(expected)) insist(stable(actual[key]) === stable(expected[key]), `Audited ${key} mismatch`);
  return actual;
}
// Compare every non-target row, not just counts, to catch triggers or accidental mutations.
function preservedState(db) {
  return Object.fromEntries(tables(db).map(t => [t, digest(db.prepare(`SELECT * FROM ${quote(t)}${t === 'source_observations' ? ' WHERE id <> ?' : ''}`)
    .all(...(t === 'source_observations' ? [TARGET] : [])).map(stable).sort())]));
}
function redactedRow(before) {
  return { ...before, ...Object.fromEntries(CLEARED.map(k => [k, null])), raw_content: '', metadata_json: METADATA,
    // NULL deliberately opts this historical shell out of fingerprint-based capture reuse.
    content_fingerprint: null };
}
function observation(r) {
  return { id: r.id, source: { sourceType: r.source_type, sourceName: r.source_name, sourceUrl: r.source_url },
    observedAt: new Date(r.observed_at), rawContent: r.raw_content, metadata: JSON.parse(r.metadata_json) };
}
async function evidenceVerifier() {
  // Bundle current source into memory only: no dist output, stale compiled code or migration side effects.
  const result = await require('esbuild').build({ stdin: { contents:
    "export {scopePromanVacancyEvidence} from './src/application/evidence/scopePromanVacancyEvidence.ts'; export {createVacancyEvidenceExtractor} from './src/application/evidence/createVacancyEvidenceExtractor.ts';",
    resolveDir: ROOT, loader: 'ts' }, bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent' });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', result.outputFiles[0].text)(module, module.exports, require);
  const api = module.exports, extractor = api.createVacancyEvidenceExtractor();
  return async r => {
    const input = observation(r), scoped = api.scopePromanVacancyEvidence(input);
    insist(scoped.rawContent === '' && scoped.metadata.acquisition.html === ''
      && scoped.metadata.acquisition.contexts.length === 0, 'Scope verification failed');
    const evidence = await extractor.extract(input);
    insist(Object.values(evidence).every(value => !Array.isArray(value) || value.length === 0), 'Evidence verification failed');
  };
}
function integrity(db) {
  insist(db.pragma('quick_check', { simple: true }) === 'ok', 'quick_check failed');
  insist(db.pragma('integrity_check', { simple: true }) === 'ok', 'integrity_check failed');
  insist(db.pragma('foreign_key_check').length === 0, 'foreign_key_check failed');
}
async function redact(db, expected, verify) {
  db.exec('BEGIN IMMEDIATE');
  try {
    precheck(db, expected);
    const before = row(db), preserved = preservedState(db), desired = redactedRow(before);
    const totalBefore = db.prepare('SELECT total_changes() AS n').get().n;
    const assignments = [...CLEARED.map(k => `${quote(k)}=NULL`), 'raw_content=?', 'metadata_json=?', 'content_fingerprint=NULL'];
    const changed = db.prepare(`UPDATE source_observations SET ${assignments.join(',')} WHERE id=?`).run('', METADATA, TARGET).changes;
    insist(changed === 1, 'Expected exactly one updated observation');
    insist(stable(row(db)) === stable(desired), 'Redacted shell mismatch');
    insist(stable(preservedState(db)) === stable(preserved), 'Non-target/history mutation detected');
    insist(db.prepare('SELECT total_changes() AS n').get().n - totalBefore === 1, 'Unexpected additional row writes');
    await verify(row(db));
    integrity(db);
    db.exec('COMMIT');
    return { preserved, desired };
  } catch (error) { if (db.inTransaction) db.exec('ROLLBACK'); throw error; }
}
function sidecars(file) {
  return Object.fromEntries(['-wal', '-shm', '-journal'].map(s => [s, fs.existsSync(file + s) ? fs.statSync(file + s).size : null]));
}
function requireNoSidecars(file) {
  insist(Object.values(sidecars(file)).every(size => size === null), 'WAL/SHM/journal exists: abort; resolve with application stopped before retrying');
}
function fileSummary(file) { const bytes = fs.readFileSync(file); return { bytes: bytes.length, sha256: hash(bytes) }; }
function readOnly(file) {
  requireNoSidecars(file);
  // Deserialized byte snapshot prevents SQLite from creating journals/SHM even in dry-run.
  const db = new Database(fs.readFileSync(file), { readonly: true });
  db.pragma('query_only=ON');
  return db;
}
function diskSettings(file) {
  requireNoSidecars(file);
  const bytes = fs.readFileSync(file);
  insist(bytes[18] === 1 && bytes[19] === 1, 'WAL database header: abort; separate stopped checkpoint review required');
  const db = new Database(file, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only=ON');
    return { journalMode: db.pragma('journal_mode', { simple: true }), secureDelete: db.pragma('secure_delete', { simple: true }) };
  } finally { db.close(); }
}
function markerCounts(bytes) {
  const s = bytes.toString('utf8');
  return Object.fromEntries(Object.entries({ email: /[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,
    phoneLike: /(?:\+33|0)[1-9](?:[ .-]?\d{2}){4}/g, dashboardMarkup: /panel-container|popin-header-nuage/g,
    sessionCategory: /csrf|_token|session|bearer|cookie/gi }).map(([key, pattern]) => [key, (s.match(pattern) ?? []).length]));
}
function report(db, expected) {
  const checks = precheck(db, expected);
  return { mode: 'DRY_RUN', database: LIVE, observationId: TARGET, canonicalId: CANONICAL, ...checks,
    journalMode: db.pragma('journal_mode', { simple: true }), secureDelete: db.pragma('secure_delete', { simple: true }),
    cleared: [...CLEARED, 'raw_content', 'acquisition HTML/pageTitle/browser/unknown metadata', 'content_fingerprint'],
    preserved: ['identity/source URL/NULL external ID/observedAt', 'claims', 'occurrences', 'all canonical/history projections', 'employer assignments'],
    backupRequiredForApply: true, applyDataPreconditionsPass: true,
    applyRequires: '--apply --confirm-stopped; no sidecars; exclusive lock; verified backup' };
}
function backup(file, before) {
  const directory = path.join(os.tmpdir(), 'JobNearby-remediation-backups', new Date().toISOString().replaceAll(':', '-') + '-' + crypto.randomUUID());
  insist(!path.resolve(directory).startsWith(ROOT + path.sep), 'Backup must be outside repository');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, 'job-nearby.pre-PROMAN-redaction.sqlite');
  fs.copyFileSync(file, destination, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(destination, 0o600);
  const info = fileSummary(destination);
  insist(info.sha256 === before.sha256, 'Backup SHA-256 mismatch');
  const db = readOnly(destination); try { integrity(db); } finally { db.close(); }
  return { path: destination, ...info };
}
const WARNING = 'BACKUP CONTAINS PRIVATE PAYLOAD. Restrict access (verify Windows ACLs); minimize retention. Restoring it reintroduces private data.';
const ROLLBACK = 'Rollback: stop application; verify backup SHA-256 matches reported hash; ensure no active WAL/journal; replace database with verified backup; run quick_check and integrity_check; restart. Rollback restores private payload.';
function parseArgs(args) {
  insist(args.every(arg => ['--apply', '--confirm-stopped', '--help'].includes(arg)), 'Unsupported argument; target/database cannot be overridden');
  insist(new Set(args).size === args.length, 'Duplicate argument');
  insist(!args.includes('--confirm-stopped') || args.includes('--apply'), '--confirm-stopped requires --apply');
  insist(!args.includes('--apply') || args.includes('--confirm-stopped') || args.includes('--help'), 'APPLY requires --confirm-stopped; stop application/server first');
  return { apply: args.includes('--apply'), stopped: args.includes('--confirm-stopped'), help: args.includes('--help') };
}
async function requireStoppedPort(port = 4317) {
  await new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); reject(new SafeError('Application port is listening; stop server before APPLY')); });
    socket.once('timeout', () => { socket.destroy(); reject(new SafeError('Cannot establish stopped port state')); });
    socket.once('error', error => error.code === 'ECONNREFUSED' ? resolve() : reject(new SafeError('Cannot establish stopped port state')));
  });
}
async function main(args) {
  const options = parseArgs(args);
  if (options.help) {
    console.log('node tools/remediate-proman.cjs [--apply --confirm-stopped]\nDefault: read-only dry-run. Stop application/server before APPLY. Never run concurrently.\n' + WARNING + '\n' + ROLLBACK);
    return;
  }
  if (options.apply) insist(options.stopped, 'APPLY requires --confirm-stopped; stop application/server first');
  insist(fs.realpathSync(LIVE) === LIVE, 'Database path must not be redirected');
  const before = fileSummary(LIVE), settings = diskSettings(LIVE), preview = readOnly(LIVE);
  try { console.log(JSON.stringify({ ...report(preview, AUDITED), ...settings, file: before }, null, 2)); } finally { preview.close(); }
  insist(fileSummary(LIVE).sha256 === before.sha256, 'Database changed during dry-run');
  if (!options.apply) return;
  console.log(WARNING + '\n' + ROLLBACK);
  await requireStoppedPort();
  const verify = await evidenceVerifier();
  await requireStoppedPort();
  console.log(JSON.stringify(await applyFile(LIVE, AUDITED, verify, before, value => console.log(JSON.stringify(value))), null, 2));
}
// Testable filesystem orchestration. The CLI supplies only LIVE and the immutable AUDITED contract.
async function applyFile(file, expected, verify, before = fileSummary(file), notify = () => {}) {
  requireNoSidecars(file);
  insist(diskSettings(file).journalMode === 'delete', 'Only audited DELETE journal mode supported');
  const db = new Database(file, { fileMustExist: true, timeout: 0 });
  let committed = false;
  let saved;
  let result;
  try {
    insist(db.pragma('journal_mode', { simple: true }) === 'delete', 'Only audited DELETE journal mode supported; WAL requires separate stopped checkpoint review');
    db.pragma('foreign_keys=ON');
    db.pragma('locking_mode=EXCLUSIVE');
    // Retain an exclusive lock across backup, logical commit and VACUUM. Refuse active readers/writers.
    db.exec('BEGIN EXCLUSIVE'); db.exec('COMMIT');
    insist(fileSummary(file).sha256 === before.sha256, 'Database changed before exclusive lock');
    precheck(db, expected);
    saved = backup(file, before);
    notify({ backup: saved, warning: WARNING, rollback: ROLLBACK });
    db.pragma('secure_delete=ON');
    insist(db.pragma('secure_delete', { simple: true }) === 1, 'secure_delete unavailable');
    result = await redact(db, expected, verify); committed = true;
    // VACUUM is deliberately outside the logical transaction; exclusive locking remains active.
    db.exec('VACUUM');
    integrity(db);
    insist(stable(row(db)) === stable(result.desired) && stable(preservedState(db)) === stable(result.preserved), 'Post-compaction state mismatch');
    insist(db.pragma('freelist_count', { simple: true }) === 0, 'Freelist remains after compaction');
    await verify(row(db));
  } catch (error) {
    if (committed) console.error('Logical redaction committed; physical completion/verification FAILED. Keep application stopped; use reported backup for reviewed recovery.');
    throw error;
  } finally { db.close(); }
  try {
    requireNoSidecars(file);
    let payloadMarkers;
    const final = readOnly(file);
    try {
      integrity(final); const r = row(final); await verify(r);
      insist(stable(r) === stable(result.desired) && stable(preservedState(final)) === stable(result.preserved), 'Reopened database state mismatch');
      payloadMarkers = markerCounts(Buffer.from(JSON.stringify({ raw: r.raw_content, metadata: JSON.parse(r.metadata_json),
        fields: Object.fromEntries(CLEARED.map(key => [key, r[key]])) })));
      insist(Object.values(payloadMarkers).every(n => n === 0), 'Target payload marker verification failed');
    } finally { final.close(); }
    return { mode: 'APPLIED', observationId: TARGET, before, after: fileSummary(file), sidecars: sidecars(file), backup: saved,
      wholeFilePatternCounts: markerCounts(fs.readFileSync(file)), targetPayloadPrivateMarkers: payloadMarkers,
      note: 'Whole-file categories may belong to unrelated rows. secure_delete overwrites deleted ordinary-table content; VACUUM rebuilds the active database. Neither guarantees forensic erasure of filesystem snapshots, storage remnants, or backups.' };
  } catch {
    throw new SafeError('Logical redaction committed; reopened-file verification FAILED. Keep application stopped and review the reported backup before recovery.');
  }
}
module.exports = { TARGET, CANONICAL, URL, METADATA, AUDITED, hash, digest, expectation, precheck, preservedState,
  redactedRow, observation, evidenceVerifier, redact, readOnly, markerCounts, report, backup, parseArgs, integrity, sidecars,
  applyFile, diskSettings, fileSummary, requireStoppedPort };
if (require.main === module) main(process.argv.slice(2)).catch(error => {
  // Never echo driver exception text, SQL values, or malformed historical metadata.
  console.error(error instanceof SafeError ? error.message : 'Remediation failed; private driver details suppressed. Keep application stopped and inspect backup/lock state.');
  process.exitCode = 1;
});
