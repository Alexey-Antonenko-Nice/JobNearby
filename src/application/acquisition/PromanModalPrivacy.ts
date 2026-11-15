/** Strict structural parser: ambiguous markup is not a trusted vacancy. */
export interface PromanNode {
  readonly tag: string;
  readonly attrs: ReadonlyMap<string, string>;
  readonly children: (PromanNode | string)[];
  readonly parent?: PromanNode;
}
const voidTags = new Set("area base br col embed hr img input link meta param source track wbr".split(" "));
const rawTags = new Set(["script", "style", "textarea", "title"]);
export function parsePromanHtml(html: string): PromanNode | undefined {
  const root: PromanNode = { tag: "root", attrs: new Map(), children: [] };
  const stack = [root];
  const tokens = /<!--[\s\S]*?-->|<![^>]*>|<\/?[a-z][\w:-]*\b(?:[^>"']|"[^"]*"|'[^']*')*>/giu;
  let end = 0;
  for (let match = tokens.exec(html); match; match = tokens.exec(html)) {
    const literal = html.slice(end, match.index);
    if (literal.includes("<")) return undefined;
    stack.at(-1)!.children.push(literal);
    end = tokens.lastIndex;
    const token = match[0];
    if (token.startsWith("<!")) continue;
    const tag = /^<\/?([\w:-]+)/u.exec(token)![1]!.toLowerCase();
    if (token.startsWith("</")) {
      if (stack.length === 1 || stack.at(-1)!.tag !== tag) return undefined;
      stack.pop();
      continue;
    }
    const attrs = new Map<string, string>();
    const body = token.slice(tag.length + 1, -1).replace(/\/$/u, "");
    const attrPattern = /\s+([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s<>"'=]+)))?/gu;
    let offset = 0;
    for (const attr of body.matchAll(attrPattern)) {
      if (body.slice(offset, attr.index).trim()) return undefined;
      const name = attr[1]!.toLowerCase();
      if (attrs.has(name)) return undefined;
      attrs.set(name, decodeAttribute(attr[2] ?? attr[3] ?? attr[4] ?? ""));
      offset = attr.index + attr[0].length;
    }
    if (body.slice(offset).trim()) return undefined;
    const parent = stack.at(-1)!;
    const node: PromanNode = { tag, attrs, parent, children: [] };
    parent.children.push(node);
    if (rawTags.has(tag)) {
      const close = new RegExp(`</${tag}\\s*>`, "giu");
      close.lastIndex = end;
      const closing = close.exec(html);
      if (!closing) return undefined;
      end = closing.index + closing[0].length;
      tokens.lastIndex = end;
    } else if (!voidTags.has(tag)) {
      if (/\/\s*>$/u.test(token)) return undefined;
      stack.push(node);
    }
  }
  if (stack.length !== 1 || html.slice(end).includes("<")) return undefined;
  root.children.push(html.slice(end));
  return root;
}
export function descendants(node: PromanNode): PromanNode[] {
  return node.children.flatMap(child => typeof child === "string" ? [] : [child, ...descendants(child)]);
}
export function hasClass(node: PromanNode, name: string): boolean {
  return (node.attrs.get("class") ?? "").split(/\s+/u).includes(name);
}
export function hiddenPromanNode(node: PromanNode): boolean {
  const style = node.attrs.get("style") ?? "";
  const classes = (node.attrs.get("class") ?? "").split(/\s+/u);
  const state = node.attrs.get("x-show");
  return ["template", "noscript", "script", "style", "form", "button", "select", "textarea", "nav", "footer"].includes(node.tag)
    || ((node.tag === "details" || node.tag === "dialog") && !node.attrs.has("open"))
    || node.attrs.has("inert") || node.attrs.has("hidden") || node.attrs.get("aria-hidden")?.toLowerCase() === "true"
    || /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse))\s*(?:!important)?\s*(?:;|$)/iu.test(style)
    || classes.some(value => /(?:^|:)(?:hidden|invisible|sr-only|collapse)$/u.test(value))
    || /\\|\/\*/u.test(style)
    || [...node.attrs.keys()].some(key => key.startsWith(":") || key.startsWith("x-bind:"))
    || node.attrs.has("x-cloak")
    || (state !== undefined && !/^activeTab === '(?:resume|poste|profil)'$/u.test(state))
    || (node.parent !== undefined && hiddenPromanNode(node.parent));
}
const excludedTags = new Set("aside article nav footer header form button input select textarea script style template noscript iframe object svg dialog address".split(" "));
const unrelated = /(?:^|[\s_-])(?:card|widget|dialog|offer|offre|vacancy|job|account|compte|profile|profil|candidate|candidat|person|recruiter|contact|favorite|favourite|favoris|application|candidature|navigation)(?:$|[\s_-])/iu;
export function unrelatedPromanNode(node: PromanNode, allowAgencyCard = false): boolean {
  if (excludedTags.has(node.tag)) return true;
  if (node.attrs.has("role") || node.attrs.has("data-offre-id")) return true;
  if ([...node.attrs.keys()].some(key => /^(?:data-|wire:|x-|on)/u.test(key))) return true;
  const classes = (node.attrs.get("class") ?? "").split(/\s+/u);
  const label = [node.attrs.get("id"), node.attrs.get("name"), ...classes.filter(c => !allowAgencyCard || c !== "card")].join(" ");
  return unrelated.test(label);
}
/** Only ordinary rich-text nodes inside the provider's one prose container are owned. */
export function promanOwnedProse(tab: PromanNode): string | undefined {
  const children = tab.children.filter((child): child is PromanNode => typeof child !== "string");
  const containers = children.filter(child => child.tag === "div" && hasClass(child, "text-body-small") && !unrelatedPromanNode(child));
  if (containers.length !== 1 || hiddenPromanNode(containers[0]!)) return undefined;
  const allowed = new Set("p ul ol li strong em b i u br span".split(" "));
  const render = (node: PromanNode): string => {
    if (hiddenPromanNode(node) || unrelatedPromanNode(node) || !allowed.has(node.tag)) return "";
    if (node.attrs.size > 0) return "";
    return `<${node.tag}>${node.children.map(child => typeof child === "string" ? child : render(child)).join("")}${voidTags.has(node.tag) ? "" : `</${node.tag}>`}`;
  };
  return containers[0]!.children.map(child => typeof child === "string" ? "" : render(child)).join("");
}
/** Summary/header facts are read only after hidden and unrelated subtrees are removed. */
export function promanOwnedFields(root: PromanNode): string {
  const allowed = new Set("div p span br h2 img i".split(" "));
  const fieldClasses = new Set("grid grid-cols-2 gap-2 mb-2 pb-4 border-b border-border-gray-3 mb-4 flex items-center text-label-small text-text-gray-2 text-body-xsmall text-body-small text-text-gray-1 mt-4 mb-1 text-label-medium card my-4 tag inline-flex text-label-large font-title mt-3 justify-between tag-border-light text-brand-primary text-title-h4 text-label-medium leading-none fi fi-rr-marker fi-rr-calendar fi-rr-clock tag-icon".split(" "));
  const render = (node: PromanNode, isRoot = false): string => {
    if (!isRoot && ([...node.attrs.keys()].some(key => key !== "class" && !(node.tag === "img" && key === "alt"))
      || (node.attrs.get("class") ?? "").split(/\s+/u).filter(Boolean).some(cls => !fieldClasses.has(cls)))) return "";
    // Block containers cannot be smuggled into a title, label or summary value.
    if (!isRoot && node.parent && ["h2", "p", "span"].includes(node.parent.tag)
      && !["span", "br", "img", "i"].includes(node.tag)) return "";
    if (root.attrs.get("class")?.split(/\s+/u).includes("popin-header-nuage")
      && node.parent === root && !["h2", "p"].includes(node.tag)) return "";
    if (hiddenPromanNode(node) || !allowed.has(node.tag) || (!isRoot && unrelatedPromanNode(node, true))) return "";
    const safeClasses = (node.attrs.get("class") ?? "").split(/\s+/u).filter(c => ["popin-header-nuage", "tag-border-light", "text-label-small", "card", "tag"].includes(c));
    const attrs = safeClasses.length ? ` class="${safeClasses.join(" ")}"` : "";
    const logo = node.tag === "img" && node.attrs.get("alt") === "Logo PROMAN" ? ' alt="Logo PROMAN"' : "";
    return `<${node.tag}${attrs}${logo}>${node.children.map(child => typeof child === "string" ? child : render(child)).join("")}${voidTags.has(node.tag) ? "" : `</${node.tag}>`}`;
  };
  return render(root, true);
}

function decodeAttribute(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/giu, (entity, code: string) => {
    if (code.startsWith("#")) {
      const n = /^#x/iu.test(code) ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return n <= 0x10ffff ? String.fromCodePoint(n) : entity;
    }
    return ({ amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", nbsp: " " } as Record<string, string>)[code.toLowerCase()] ?? entity;
  });
}
