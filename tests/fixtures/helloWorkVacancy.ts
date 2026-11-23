export const helloWorkUrl = "https://www.hellowork.com/fr-fr/emplois/84500085.html";
export const helloWorkPosting = {
  "@type": "JobPosting", url: helloWorkUrl, title: "Technicien de Maintenance H/F",
  hiringOrganization: { name: "Crit" },
  jobLocation: { address: { addressLocality: "Strasbourg", addressRegion: "Grand Est", addressCountry: "FR" } },
  employmentType: "FULL_TIME", baseSalary: { currency: "EUR", value: { value: "13,00", unitText: "HOUR" } },
};
export const helloWorkPanel = `<div id="offer-panel" role="tabpanel" aria-labelledby="offer-tab">
  <div><h1 id="main-content"><span data-cy="jobTitle">Technicien de Maintenance H/F</span>
    <a href="/fr-fr/entreprises/crit-6287.html">Crit</a></h1><ul><li>Strasbourg - 67</li><li>CDI</li></ul></div>
  <ul><li>13 € / heure</li><li>Agence d'intérim</li><li>Exp. 0 - 1 an (débutants acceptés)</li></ul>
  <section><h2>Les missions du poste</h2><p>Nous recherchons pour notre client un technicien.
    Le poste requiert une expérience de 0 à 1 an.</p></section>
  <details><summary>Le profil recherché</summary><p>Première expérience réussie de 0 à 1 an.</p></details>
</div>`;
export const helloWorkRelated = `<aside><p>Cabinet de recrutement Outside Agency</p></aside>
<div id="similar-offers"><h2>Ces offres pourraient aussi vous intéresser</h2>
<a href="/fr-fr/emplois/99999999.html">Autre Technicien H/F</a><p>FEHR</p><p>Bischwiller</p>
<p>32 000 - 36 000 € / an</p><p>Expérience de 10 à 15 ans</p><p>Temps partiel</p>
<p>L'Industrie recrute</p>
<p>maîtrise de l'allemand</p><p>déplacements réguliers</p></div>`;
export const jsonLd = (postings: unknown) => `<script type="application/ld+json">${JSON.stringify(postings)}</script>`;
export const helloWorkHtml = `${jsonLd(helloWorkPosting)}${helloWorkPanel}${helloWorkRelated}`;
