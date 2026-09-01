const SELECTED_ATTRIBUTES = [
  "id",
  "componentkey",
  "data-view-name",
  "data-job-id",
  "data-sdui-screen",
  "data-testid",
  "data-component-type",
  "href",
  "class",
] as const;

export function diagnoseLinkedInDirectViewDom(html: string, externalId: string) {
  const elements = openingTagMatches(html).filter((match) =>
    match[0].includes(externalId));
  const primaryMarker = `JobDetails_AboutTheJob_${externalId}`;
  const cardMarker = `job-card-component-ref-${externalId}`;
  return {
    htmlLength: html.length,
    markers: {
      primaryJobDetailsCount: countOccurrences(html, primaryMarker),
      jobCardComponentReferenceCount: countOccurrences(html, cardMarker),
    },
    exactIdAttributeElements: elements.slice(0, 12).map((match) => ({
      tag: /^<([a-z][\w:-]*)/iu.exec(match[0])?.[1]?.toLocaleLowerCase(),
      offset: match.index,
      attributes: Object.fromEntries(SELECTED_ATTRIBUTES.flatMap((name) => {
        const value = attribute(match[0], name);
        return value === undefined ? [] : [[name, bounded(value, 180)]];
      })),
    })),
    semanticContainers: semanticContainers(html, externalId),
  };
}

function semanticContainers(html: string, externalId: string) {
  return openingTagMatches(html, "div").flatMap((match) => {
    const id = attribute(match[0], "id");
    const kind = attribute(match[0], "data-sdui-screen") ===
        "com.linkedin.sdui.flagshipnav.jobs.JobDetails"
      ? "JOB_DETAILS_SCREEN"
      : attribute(match[0], "data-testid") === "lazy-column"
        ? "LAZY_COLUMN"
        : id === `JobDetails_AboutTheJob_${externalId}`
          ? "ABOUT_THE_JOB"
          : undefined;
    if (kind === undefined) return [];
    const fragment = balancedDiv(html, match.index);
    if (fragment === undefined) return [];
    return [{
      kind,
      offset: match.index,
      htmlLength: fragment.length,
      containsPrimaryJobDetails: fragment.includes(
        `id="JobDetails_AboutTheJob_${externalId}"`,
      ),
      textPreview: bounded(htmlToText(fragment), 240),
    }];
  }).slice(0, 8);
}

function openingTagMatches(html: string, tagName = "[a-z][\\w:-]*") {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, "giu"))];
}

function balancedDiv(html: string, start: number): string | undefined {
  const tags = /<\/?div\b[^>]*>/giu;
  tags.lastIndex = start;
  let depth = 0;
  let match: RegExpExecArray | null;
  while ((match = tags.exec(html)) !== null) {
    if (match.index === start || !match[0].startsWith("</")) depth += 1;
    else depth -= 1;
    if (depth === 0) return html.slice(start, tags.lastIndex);
  }
  return undefined;
}

function attribute(tag: string, name: string): string | undefined {
  const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "iu").exec(tag);
  return match?.[1] ?? match?.[2];
}

function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/gu, " ").replace(/&nbsp;/giu, " ")
    .replace(/\s+/gu, " ").trim();
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

function bounded(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 3)}...`;
}
