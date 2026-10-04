import type { PublicationCampaignContext } from "./api";

export function PublicationCampaignContextSection({ context }: { readonly context: PublicationCampaignContext }): React.JSX.Element | null {
  const families = context.publicationFamilies ?? [];
  const campaigns = context.recruitmentCampaigns ?? [];
  if (families.length === 0 && campaigns.length === 0) return null;
  return <section aria-label="Publication and campaign context">
    <h2>Publication and campaign context</h2>
    <p>Publication families: {families.length} · Recruitment campaigns: {campaigns.length}</p>
    {families.map((family) => <article key={family.id} aria-label={`Family ${family.id}`}>
      <h3>{family.representativeTitle ?? `Family ${family.id}`}</h3>
      {family.representativeTitle && <p>Family {family.id}</p>}
      <p>{family.observationCount} observations in this family · {family.currentVacancyObservationCount} from this vacancy</p>
      <p>Sources: {family.sourceProviders.join(", ") || "Unknown"}</p>
      <p>First seen: {date(family.firstSeenAt)} · Last seen: {date(family.lastSeenAt)}</p>
    </article>)}
    {campaigns.map((campaign) => <article key={campaign.id} aria-label={`Campaign ${campaign.id}`}>
      <h3>Campaign {campaign.id}</h3>
      <p>Status: {campaign.status}</p>
      <p>Campaign first observed: {date(campaign.firstObservedAt)} · Last observed: {date(campaign.lastObservedAt)}</p>
      <ul>{campaign.relationshipPaths.map((path) => <li key={path.membershipId}>
        {path.pathType === "PUBLICATION_FAMILY" ? `Related through family ${path.publicationFamilyId}` : `Direct observation relationship: ${path.sourceObservationId}`}
      </li>)}</ul>
    </article>)}
  </section>;
}
function date(value: string | null): string { return value === null ? "Unknown" : new Date(value).toLocaleDateString(); }
