// URL slugs, shared by server and client code.
//   teams    /teams/notre-dame
//   players  /players/cj-carr-5079369  (name for humans, ESPN athlete id for uniqueness)

export const slugify = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[&'’ʻ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export const playerSlug = (name: string, id: string) => `${slugify(name) || "player"}-${id}`;
export const playerHref = (name: string, id: string) => `/players/${playerSlug(name, id)}`;

/** "cj-carr-5079369" or a bare "5079369" -> "5079369" */
export const playerIdFromSlug = (slug: string) => (slug.match(/(?:^|-)(\d+)$/) || [])[1] ?? null;
