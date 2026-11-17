import { VacancyCrmError, validateNote, validatePriority, type VacancyCrmRepository, type VacancyPriority } from "../../domain/user/VacancyCrm.js";
import type { CanonicalVacancyRepository } from "../../domain/vacancies/CanonicalVacancyRepository.js";
interface Dependencies {
  readonly crmRepository: VacancyCrmRepository;
  readonly canonicalVacancyRepository: Pick<CanonicalVacancyRepository,"findById">;
  readonly now?: (() => Date) | undefined;
}
async function requireVacancy(id:string,deps:Dependencies) {
  if(!await deps.canonicalVacancyRepository.findById(id)) throw new VacancyCrmError("Vacancy no longer exists.",404);
}
export async function setVacancyPriority(input:{canonicalVacancyId:string;priority:VacancyPriority},deps:Dependencies):Promise<void> {
  validatePriority(input.priority);
  await requireVacancy(input.canonicalVacancyId,deps);
  await deps.crmRepository.setPriority(input.canonicalVacancyId,input.priority);
}
export async function addVacancyNote(input:{canonicalVacancyId:string;requestId:string;text:string},deps:Dependencies):Promise<void> {
  const note={id:input.requestId,canonicalVacancyId:input.canonicalVacancyId,text:input.text,createdAt:deps.now?.() ?? new Date()};
  validateNote(note);
  await requireVacancy(input.canonicalVacancyId,deps);
  await deps.crmRepository.addNote(note);
}

