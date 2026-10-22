export const adeccoId = "2129846001";
export const adeccoSearchUrl = "https://www.adecco.com/fr-fr/offres-emploi?jobTitle=Techniciens+de+maintenance&jobLocation=Strasbourg%2C+France&radius=20";
export const adeccoDirectUrl = `https://www.adecco.com/fr-fr/offres-emploi/technicien-de-maintenance-hf-strasbourg-bas-rhin/${adeccoId}`;
export const adeccoHeader = `<div class="flex_col scrollbar-box"><div class="h3">Technicien de Maintenance (h/f)</div>
<div class="text-salary">€ 34000 - € 44000 / Annuel</div>
<div class="job-icon"><span>location_on</span><span>STRASBOURG, Bas-Rhin</span></div>
<div class="job-icon"><span>work_outline</span><span>CDI</span></div>
<div class="job-icon"><span>event</span><span>Début de contrat : 04-01-2027</span></div>
<div class="job-icon"><span>acute</span><span>Temps plein</span></div>
<div class="job-icon"><span>business</span><span>Organisation : Privée</span></div>
<div class="job-icon"><span>format_list_numbered</span><span>Poste(s) à pourvoir : 1</span></div></div>`;
export const adeccoDescription = `<div class="VacancyDescription"><h2>Votre mission</h2>
<p>Le Cabinet Adecco Recrutement CDD/CDI recrute pour l’un de ses clients un technicien en CDI.</p>
<p>Assurer la maintenance préventive et curative des installations du site.</p><h2>Votre profil</h2><p>Formation en maintenance industrielle.</p></div>`;
export const adeccoPane = (header = adeccoHeader, description = adeccoDescription) => `<section class="JobSearch_generatedClass job_Details"><section>
<section class="scrollbar-wrapper">${header}<button>Postuler</button>${description}
<p>Référence : <b class="job-id">${adeccoId}</b></p><a class="static_jobdetailpage_url" href="${adeccoDirectUrl}">Voir la page de détail de l’offre</a></section></section></section>`;
export const adeccoOutside = `<div><input value="Strasbourg, France"><p>Télétravail</p></div><section class="job-card">
<h2>Technicien de Maintenance CVC (h/f)</h2><p>€ 34000 - € 38250 / Annuel</p><p>ILLKIRCH GRAFFENSTADEN, Bas-Rhin</p>
<p>au moins 5 ans d'expérience</p><p>maîtrise de l'allemand</p><p>déplacements réguliers</p></section>`;
export const adeccoPage = (pane = adeccoPane()) => `<nav>Navigation Adecco</nav>${adeccoOutside}${pane}<footer>Footer Company</footer>`;
