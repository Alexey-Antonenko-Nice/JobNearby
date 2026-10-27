import { useState } from "react";
import { cleanupRequest, type VacancyCleanupState, type VacancyDeletionPreview } from "./api";

export function VacancyCleanupSection({ id, onChanged }: { id: string; onChanged: (deleted: boolean) => Promise<void> }): React.JSX.Element {
  const [state, setState] = useState<VacancyCleanupState | null>(null);
  const [preview, setPreview] = useState<VacancyDeletionPreview | null>(null);
  const [target, setTarget] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [deleted, setDeleted] = useState(false);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : "Unable to complete cleanup."); setPreview(null); setState(null); }
    finally { setBusy(false); }
  }
  const reset = () => { setPreview(null); setConfirmation(""); setAcknowledged(false); };
  if (deleted) return <section role="status">Vacancy permanently deleted. <a href="/">Return to inbox</a></section>;
  return <section className="vacancy-cleanup" aria-label="Manage vacancy"><h2>Manage vacancy</h2>
    {error && <p role="alert">{error}</p>}
    {!state ? <button disabled={busy} onClick={() => void run(async () => setState((await cleanupRequest<{ cleanup: VacancyCleanupState }>(id, "cleanup")).cleanup))}>Load cleanup options</button> : <>
      <p>{state.archived ? "Archived — excluded from the active list and future fit review." : "Active vacancy"}</p>
      <button disabled={busy} onClick={() => void run(async () => { reset(); setState((await cleanupRequest<{ cleanup: VacancyCleanupState }>(id, "archive", { token: state.token, archived: !state.archived })).cleanup); })}>{state.archived ? "Restore vacancy" : "Archive vacancy"}</button>
      {state.archived && <>
        <label>Delete <select disabled={busy} value={target} onChange={e => { setTarget(e.target.value); reset(); }}><option value="">Entire vacancy and its history</option>{state.captures.length > 1 && state.captures.map(c => <option key={c.id} value={c.id}>One capture: {c.title ?? c.url ?? c.id} — {c.observedAt}</option>)}</select></label>
        <button disabled={busy} onClick={() => void run(async () => { reset(); setPreview((await cleanupRequest<{ preview: VacancyDeletionPreview }>(id, "deletion-preview" + (target ? "?observationId=" + encodeURIComponent(target) : ""))).preview); })}>Preview permanent deletion</button>
      </>}
      {preview && <div aria-label="Deletion preview">
        <h3>{preview.title ?? "Vacancy"}: permanent deletion preview</h3>
        <ul>{preview.captures.filter(c => !preview.targetObservationId || c.id === preview.targetObservationId).map(c => <li key={c.id}>{c.url ?? c.id} — {c.observedAt}</li>)}</ul>
        <ul>{preview.affected.map(a => <li key={a.label}>{a.label}: {a.count}</li>)}</ul>
        <p>Shared employer identities and evidence used by shared employer memory are preserved. Deletion cannot be undone.</p>
        {target && <p>Vacancy decisions and history remain. Facts will be recomputed from the remaining captures.</p>}
        <label>Type DELETE to confirm <input value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label>
        {preview.requiresHistoryAcknowledgement && <label><input type="checkbox" checked={acknowledged} disabled={busy} onChange={e => setAcknowledged(e.target.checked)} />I acknowledge that this vacancy has application or interview history and have reviewed what will be removed.</label>}
        <button disabled={busy || confirmation !== "DELETE" || (preview.requiresHistoryAcknowledgement && !acknowledged)} onClick={() => void run(async () => {
          const result = await cleanupRequest<{ deletedVacancy: boolean }>(id, "deletion", { token: preview.token, confirmation, acknowledgeApplicationHistory: acknowledged, ...(preview.targetObservationId ? { observationId: preview.targetObservationId } : {}) });
          reset();
          if (result.deletedVacancy) { setDeleted(true); await onChanged(true); }
          else { setTarget(""); setState((await cleanupRequest<{ cleanup: VacancyCleanupState }>(id, "cleanup")).cleanup); await onChanged(); }
        })}>Permanently delete</button>
      </div>}
    </>}
  </section>;
}
