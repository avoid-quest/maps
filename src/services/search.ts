import type { Coordinate, Place, PlaceKind, SearchOptions, SearchResult } from "../domain/types";
import { distanceMeters, normalize } from "./geo";
import { checkAbort, fetchJSON, parseServiceData, requestQueue, ServiceError } from "./network";
import { getPlaceCoverage, LOCAL_SEARCH_RADIUS_METERS } from "./place-coverage";
import localityData from "../data/localities.json";
import { isTransitQuery } from "./transit-search";
import { correctionAttribution, placeCatalog, type CatalogPlace, type PlaceCatalog, type PlaceSearchEntry } from "./place-catalog";
const request = requestQueue(1000);
const LOCAL_RESULT_LIMIT = 60;
const ONLINE_RESULT_LIMIT = 40;
type PlaceGroup = { place: Place; catalogIds: string[] };
type GroupInput = { place: Place | PlaceSearchEntry; catalogIds: readonly string[] };
export const SEARCH_CATEGORIES = [
  { id: "food", label: "Mangiare", query: "ristoranti" },
  { id: "coffee", label: "Caffè", query: "bar" },
  { id: "shops", label: "Negozi", query: "negozi" },
  { id: "groceries", label: "Spesa", query: "supermercato" },
] as const;
const aliases: Record<string, string[]> = {
  ristorante: ["restaurant", "food_and_drink"],
  ristoranti: ["restaurant", "food_and_drink"],
  mangiare: ["restaurant", "food_and_drink"],
  "dove mangiare": ["restaurant", "food_and_drink"],
  pizza: ["pizza", "pizzeria"],
  pizzeria: ["pizza", "pizzeria"],
  pizzerie: ["pizza", "pizzeria"],
  hamburger: ["burger", "american_restaurant", "fast_food"],
  burger: ["burger", "american_restaurant"],
  bar: ["bar", "cafe", "coffee"],
  caffe: ["cafe", "coffee"],
  cafe: ["cafe", "coffee"],
  caffetteria: ["cafe", "coffee"],
  caffetterie: ["cafe", "coffee"],
  "wine bar": ["wine_bar", "bar"],
  negozi: ["shopping"],
  negozio: ["shopping"],
  supermercato: ["supermarket", "grocery", "discount_store"],
  supermercati: ["supermarket", "grocery", "discount_store"],
  alimentari: ["grocery", "convenience_store"],
  minimarket: ["grocery", "convenience_store"],
  spesa: ["supermarket", "grocery", "convenience_store", "discount_store"],
  abbigliamento: ["fashion", "clothing", "apparel"],
  farmacia: ["pharmacy"],
  farmacie: ["pharmacy"],
  gelato: ["ice_cream", "gelato"],
  gelateria: ["ice_cream", "gelato"],
  gelaterie: ["ice_cream", "gelato"],
  ferramenta: ["hardware_store"],
  panetteria: ["bakery"],
  panetterie: ["bakery"],
  macelleria: ["butcher_shop"],
  macellerie: ["butcher_shop"],
  libreria: ["bookstore"],
  librerie: ["bookstore"],
  tabaccheria: ["tobacco_shop"],
  tabaccherie: ["tobacco_shop"],
  edicola: ["newspaper_and_magazines_store"],
  edicole: ["newspaper_and_magazines_store"],
  fiorista: ["florist", "flowers_and_gifts_store"],
  fioristi: ["florist", "flowers_and_gifts_store"],
};
const displayCategories: Record<string, string> = {
  restaurant: "Ristorante",
  italian_restaurant: "Ristorante italiano",
  pizza_restaurant: "Pizzeria",
  pizzeria: "Pizzeria",
  bar: "Bar",
  cafe: "Caffè",
  coffee_shop: "Caffetteria",
  wine_bar: "Enoteca e wine bar",
  pub: "Pub",
  hookah_bar: "Bar con narghilè",
  supermarket: "Supermercato",
  grocery_store: "Alimentari",
  convenience_store: "Minimarket",
  discount_store: "Discount",
  clothing_store: "Abbigliamento",
  fashion_and_apparel_store: "Abbigliamento",
  fashion_boutique: "Boutique",
  womens_clothing_store: "Abbigliamento donna",
  childrens_clothing_store: "Abbigliamento bambini",
  shopping: "Negozio",
  pharmacy: "Farmacia",
  drugstore: "Cura della persona",
  bakery: "Panetteria",
  delicatessen: "Gastronomia",
  butcher_shop: "Macelleria",
  ice_cream_shop: "Gelateria",
  gelato_shop: "Gelateria",
  dessert_shop: "Pasticceria",
  burger_restaurant: "Hamburger",
  fast_food_restaurant: "Fast food",
  doner_kebab_restaurant: "Kebab",
  chinese_restaurant: "Ristorante cinese",
  furniture_store: "Arredamento",
  furniture_accessory_store: "Accessori per arredamento",
  fabric_store: "Tessuti",
  building_supply_store: "Materiali edili",
  jewelry_store: "Gioielleria",
  mobile_phone_store: "Telefonia",
  eyewear_store: "Ottica",
  shoe_store: "Calzature",
  electronics_store: "Elettronica",
  hardware_store: "Ferramenta",
  auto_dealer: "Concessionaria",
  tobacco_shop: "Tabaccheria",
  appliance_store: "Elettrodomestici",
  flowers_and_gifts_store: "Fiori e regali",
  florist: "Fiorista",
  newspaper_and_magazines_store: "Edicola",
  beauty_supply_store: "Prodotti di bellezza",
  cosmetics_and_fragrance_store: "Profumeria",
  smoke_and_vape_store: "Sigarette elettroniche",
  motorcycle_dealer: "Concessionaria moto",
  arts_crafts_and_hobby_store: "Arte e hobby",
  pet_store: "Animali",
  home_improvement_store: "Fai da te",
  home_goods_store: "Articoli per la casa",
  bookstore: "Libreria",
  auto_parts_store: "Ricambi auto",
  winery: "Cantina",
  toy_store: "Giocattoli",
  sportswear_store: "Abbigliamento sportivo",
};
export function categoryLabel(category?: string | null): string {
  if (!category) return "Luogo";
  if (displayCategories[category]) return displayCategories[category]!;
  if (category.endsWith("_restaurant")) return "Ristorante";
  if (category.endsWith("_store") || category.endsWith("_shop"))
    return "Negozio";
  if (category.endsWith("_bar")) return "Bar";
  // User-visible labels supplied by the app, such as a transit stop, are already localized.
  return category.includes("_") ? "Attività" : category;
}
const words = (value: string) => normalize(value).split(" ").filter(Boolean);
const taxonomyTerms = [...new Set(Object.values(aliases).flat())];
// Hundreds of taxonomy definitions are shared by thousands of places.
const categoryMemberships = new Map<string, Set<string>>();
function categoryMembership(categories: string[]): Set<string> {
  const key = JSON.stringify(categories);
  const cached = categoryMemberships.get(key);
  if (cached) return cached;
  const terms = new Set(taxonomyTerms.filter((term) => categories.some((category) =>
    // The combined pharmacy_and_drug_store family also contains general personal-care retailers.
    term === "pharmacy" ? category === term : `_${category}_`.includes(`_${term}_`),
  )));
  categoryMemberships.set(key, terms);
  return terms;
}
// Keep full provenance in the catalog; normalize lightweight search entries once.
function createIndex(places: readonly PlaceSearchEntry[]) {
  return places.map((place) => {
    const name = normalize(place.name);
    const nameWords = words(name);
    const categories = [place.category, ...place.hierarchy].filter(
      (value): value is string => Boolean(value),
    );
    return {
      place, name, nameWords,
      addressWords: words(place.address ?? ""),
      categoryTerms: categoryMembership(categories),
    };
  });
}
type IndexEntry = ReturnType<typeof createIndex>[number];
const index = createIndex(placeCatalog.entries);

/** One insertion/deletion/substitution or adjacent transposition, only for full alphabetic tokens. */
function oneTypo(a: string, b: string): boolean {
  if (a.length < 4 || b.length < 4 || !/^[a-z]+$/.test(a) || !/^[a-z]+$/.test(b)) return false;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < Math.min(a.length, b.length) && a[i] === b[i]) i += 1;
  if (i === Math.min(a.length, b.length)) return true;
  if (a.length > b.length) return a.slice(i + 1) === b.slice(i);
  if (b.length > a.length) return a.slice(i) === b.slice(i + 1);
  return a.slice(i + 1) === b.slice(i + 1) ||
    (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
}

function tokenMatches(token: string, word: string): boolean {
  return /^\d+$/.test(token) ? word === token : word.startsWith(token);
}

/** A neighbourhood read from the bundled OpenStreetMap gazetteer; its radius is approximate. */
export interface Locality { id: string; name: string; kind: string; coordinate: Coordinate; radiusMeters: number; words: string[] }
const LOCALITY_ATTRIBUTION = localityData.attribution;
const LOCALITIES: readonly Locality[] = localityData.localities.map((item) => ({
  id: item.id, name: item.name, kind: item.kind, radiusMeters: item.radiusMeters,
  coordinate: { latitude: item.latitude, longitude: item.longitude }, words: words(item.name),
}));
// Linking words are optional: "farmacia in via Po" and "bar a San Salvario" read like their bare forms.
const FILLER_WORDS = new Set(["di", "del", "della", "dei", "delle", "da", "a", "al", "alla", "ai", "in", "presso", "vicino", "zona", "quartiere"]);

/** How a typed query reads: its words, which are optional and which spell a known neighbourhood. */
export interface QueryPlan {
  normalized: string;
  tokens: string[];
  /** Tokens that every match must account for. */
  required: boolean[];
  /** At most one neighbourhood, spelled by whole consecutive words. */
  locality: { locality: Locality; start: number; end: number } | null;
  /** The whole query is one Italian category ("farmacie", "ristoranti"). */
  categoryTerms: string[];
}

export function planQuery(query: string): QueryPlan {
  const normalized = normalize(query);
  const tokens = words(normalized);
  const optional = tokens.map((token) => FILLER_WORDS.has(token));
  const required = optional.some((item) => !item) ? optional.map((item) => !item) : tokens.map(() => true);
  let locality: QueryPlan["locality"] = null;
  // The longest neighbourhood spelled by whole words wins ("Barriera di Milano" over "Milano").
  for (const candidate of LOCALITIES) {
    const size = candidate.words.length;
    if (locality && locality.end - locality.start >= size) continue;
    for (let start = 0; start + size <= tokens.length; start += 1) {
      if (candidate.words.every((word, offset) => tokens[start + offset] === word)) { locality = { locality: candidate, start, end: start + size }; break; }
    }
  }
  return { normalized, tokens, required, locality, categoryTerms: aliases[normalized] ?? [] };
}

/** Name evidence outranks category, address and area evidence; a typo is the weakest. */
const NAME = 3, FIELD = 2, TYPO = 1;
function tokenEvidence(token: string, entry: IndexEntry): number {
  if (!aliases[token] && entry.nameWords.some((word) => tokenMatches(token, word))) return NAME;
  // A category word means the category or that whole word in the name: "bar" never matches
  // "Barbagusto" or "Via Baretti".
  if (aliases[token]) return entry.nameWords.includes(token) ? NAME : aliases[token]!.some((term) => entry.categoryTerms.has(term)) ? FIELD : 0;
  if (entry.addressWords.some((word) => tokenMatches(token, word))) return FIELD;
  return entry.nameWords.some((word) => oneTypo(token, word)) ? TYPO : 0;
}

/** Adjacent query words found in the same order in the address, such as "via po" or "nizza 230". */
function addressPhrase(tokens: string[], addressWords: string[]): number {
  let best = 0;
  for (let start = 0; start < tokens.length; start += 1) {
    for (let at = 0; at < addressWords.length; at += 1) {
      let length = 0;
      while (start + length < tokens.length && at + length < addressWords.length && addressWords[at + length] === tokens[start + length]) length += 1;
      best = Math.max(best, length);
    }
  }
  return best > 1 ? best : 0;
}

function localityPlace(locality: Locality, center: Coordinate): Place {
  return {
    id: `locality:${locality.id}`, name: locality.name, coordinate: { ...locality.coordinate }, kind: "area",
    category: locality.kind, source: "OpenStreetMap (quartieri)", attributions: [LOCALITY_ATTRIBUTION],
    dataUpdatedAt: localityData.osmBase ?? undefined, distanceMeters: distanceMeters(center, locality.coordinate),
  };
}

type Match = { place: Place | PlaceSearchEntry; rank: number; score: number; distance: number; catalogIds: string[] };

function localMatches(query: string, center: Coordinate, searchIndex = index, catalog = placeCatalog) {
  const plan = planQuery(query);
  const { normalized: q, tokens, required, locality, categoryTerms } = plan;
  const coverage = getPlaceCoverage(center, categoryTerms.length ? LOCAL_SEARCH_RADIUS_METERS : null, [...catalog.metadata.bounds]);
  if (q.length < 2) return { groups: [] as PlaceGroup[], coverage, plan };
  const origin = locality?.locality.coordinate ?? center;
  const matches: Match[] = [];
  for (const entry of searchIndex) {
    let rank = 0;
    let score = 0;
    if (categoryTerms.length) {
      // A restaurant furniture supplier is not somewhere to eat, even if its name matches.
      if (categoryTerms.some((term) => entry.categoryTerms.has(term))) rank = 4;
    } else if (entry.name === q) rank = 6;
    else {
      let weakest = NAME;
      let byName = 0;
      let outsideArea = false;
      let evaluated = 0;
      score = 0;
      for (const [i, token] of tokens.entries()) {
        if (locality && i >= locality.start && i < locality.end) continue;
        if (!required[i]) { if (entry.nameWords.includes(token)) score += 1; continue; }
        evaluated += 1;
        const evidence = tokenEvidence(token, entry);
        if (evidence) outsideArea = true;
        if (evidence === NAME) byName += 1;
        weakest = Math.min(weakest, evidence);
        // Category words describe what was asked for; distance, not their spelling, orders those matches.
        if (!aliases[token]) score += (evidence === NAME ? 2 : 0) + (entry.nameWords.includes(token) || entry.addressWords.includes(token) ? 1 : 0);
      }
      if (locality) {
        // The neighbourhood's words count as one: all in the name, all in the address, or the place lies inside it.
        const span = tokens.slice(locality.start, locality.end);
        const inName = span.every((token) => entry.nameWords.some((word) => tokenMatches(token, word)));
        const inArea = inName || span.every((token) => entry.addressWords.includes(token))
          || distanceMeters(entry.place.coordinate, locality.locality.coordinate) <= locality.locality.radiusMeters;
        evaluated += span.length;
        if (inName) { byName += span.length; score += span.length * 2; }
        if (!inArea) weakest = 0;
      }
      // Every required word is accounted for, and not only by the neighbourhood: "San Salvario"
      // alone names the area, it does not list every business inside it.
      if (weakest > 0 && outsideArea) {
        rank = weakest === TYPO ? 2 : byName === evaluated ? 5 : 3;
        score += addressPhrase(tokens, entry.addressWords) * 2;
      }
    }
    if (!rank) continue;
    const distance = distanceMeters(center, entry.place.coordinate);
    if (categoryTerms.length && distance > LOCAL_SEARCH_RADIUS_METERS) continue;
    matches.push({
      place: { ...entry.place, distanceMeters: distance }, rank, score, catalogIds: [entry.place.id],
      distance: origin === center ? distance : distanceMeters(origin, entry.place.coordinate),
    });
  }
  if (!categoryTerms.length && q.length >= 3) {
    // The neighbourhood itself: first when named exactly, after full-name matches when typed partly.
    for (const candidate of LOCALITIES) {
      const key = candidate.words.join(" ");
      if (key === q || (key.startsWith(q) && q.length >= 4)) {
        matches.push({ place: localityPlace(candidate, center), rank: key === q ? 7 : 4.5, score: 0, catalogIds: [], distance: 0 });
      }
    }
  }
  matches.sort((a, b) => b.rank - a.rank || b.score - a.score ||
    a.distance - b.distance || a.place.id.localeCompare(b.place.id));
  return { groups: deduplicateGroups(matches.map(({ place, catalogIds }) => ({ place, catalogIds }))), coverage, plan };
}

function limitedPlaces(groups: PlaceGroup[], limit: number, catalog: PlaceCatalog) {
  return {
    places: groups.slice(0, limit).map(({ place, catalogIds }) => {
      // Cap complete result groups first; only displayed duplicates need full source objects.
      const contributors = catalogIds.map((id) => catalog.materialize(id)).filter((item): item is CatalogPlace => Boolean(item));
      const full = contributors.find((item) => item.id === place.id);
      const result = { ...full, ...place, coordinate: { ...place.coordinate }, attributions: [...place.attributions],
        ...(full ? { hierarchy: full.hierarchy } : {}) };
      if (contributors.length) {
        result.provenance = contributors.flatMap((item) => item.provenance);
        // Keep upstream timestamp strings intact, including those with no stated timezone.
        result.dataUpdatedAt = contributors.reduce((latest, item) => (item.dataUpdatedAt ?? '') > latest ? item.dataUpdatedAt! : latest, '');
        const corrections = [...new Map(contributors.flatMap((item) => item.fieldCorrections ?? [])
          .map((correction) => [JSON.stringify(correction), correction] as const)).values()];
        const applied = corrections.filter((correction) => result[correction.field] === correction.value);
        const unusedNotices = new Set(corrections.filter((correction) => result[correction.field] !== correction.value).map(correctionAttribution));
        const appliedNotices = new Set(applied.map(correctionAttribution));
        result.attributions = result.attributions.filter((notice) => !unusedNotices.has(notice) || appliedNotices.has(notice));
        delete result.fieldCorrections;
        if (applied.length) result.fieldCorrections = applied;
      }
      return result;
    }),
    resultLimit: limit, truncated: groups.length > limit,
  };
}

function localResult(matches: ReturnType<typeof localMatches>, catalog = placeCatalog): SearchResult {
  return {
    ...limitedPlaces(matches.groups, LOCAL_RESULT_LIMIT, catalog),
    warnings: [], source: "Overture Places locale", coverage: matches.coverage,
  };
}

/** The same local search over an injected catalog, used to validate package boundaries and migrations. */
export function createLocalPlaceSearch(catalog: PlaceCatalog) {
  const searchIndex = createIndex(catalog.entries);
  return (query: string, center: Coordinate): SearchResult => localResult(localMatches(query, center, searchIndex, catalog), catalog);
}

export function searchLocalResult(query: string, center: Coordinate): SearchResult {
  return localResult(localMatches(query, center));
}

export function searchLocalPlaces(query: string, center: Coordinate): Place[] {
  return searchLocalResult(query, center).places;
}
/** Only matching names within 70 m merge; co-located independent tenants remain separate. */
export function deduplicatePlaces(input: readonly (Place | PlaceSearchEntry)[]): Place[] {
  return deduplicateGroups(input.map((place) => ({ place, catalogIds: [] }))).map((group) => group.place);
}
function deduplicateGroups(input: readonly GroupInput[]): PlaceGroup[] {
  const results: PlaceGroup[] = [];
  const byId = new Map<string, PlaceGroup>();
  const byName = new Map<string, PlaceGroup[]>();
  for (const { place, catalogIds } of input) {
    const name = normalize(place.name);
    const existing = byId.get(place.id) ?? byName.get(name)?.find(
      (candidate) => distanceMeters(candidate.place.coordinate, place.coordinate) < 70,
    );
    if (!existing) {
      const next = { place: { ...place, coordinate: { ...place.coordinate }, attributions: [...place.attributions] }, catalogIds: [...catalogIds] };
      results.push(next);
      byId.set(place.id, next);
      const sameName = byName.get(name) ?? [];
      sameName.push(next);
      byName.set(name, sameName);
    } else {
      byId.set(place.id, existing);
      existing.catalogIds = [...new Set([...existing.catalogIds, ...catalogIds])];
      existing.place.attributions = [
        ...new Set([...existing.place.attributions, ...place.attributions]),
      ];
      existing.place.website ??= place.website;
      existing.place.phone ??= place.phone;
      existing.place.address ??= place.address;
      if (!existing.place.source.includes(place.source))
        existing.place.source += ` + ${place.source}`;
    }
  }
  return results;
}
type PhotonResponse = {
  features: {
    geometry: { coordinates: number[] };
    properties: Record<string, string | number>;
  }[];
};
const AREA_TYPES = new Set(["city", "district", "locality", "county", "state", "country"]);
/** One Photon feature as a result, labelled as a venue, civic address, street or area. */
function photonPlace(feature: PhotonResponse["features"][number], center: Coordinate, query: string): Place[] {
  if (!feature.geometry?.coordinates || feature.geometry.coordinates.length < 2) return [];
  const p = feature.properties ?? {};
  const text = (value: unknown) => value === undefined || value === null || value === "" ? "" : String(value);
  const coordinate = { longitude: feature.geometry.coordinates[0]!, latitude: feature.geometry.coordinates[1]! };
  const key = text(p.osm_key), value = text(p.osm_value), type = text(p.type);
  const street = [text(p.street), text(p.housenumber)].filter(Boolean).join(" ");
  const locality = [text(p.postcode), text(p.city)].filter(Boolean).join(" ");
  const kind: PlaceKind = !p.name && (type === "house" || value === "house") && p.housenumber ? "address"
    // Only Photon's street type is a street: named highway objects include bus stops (type "house").
    : type === "street" ? "street"
      : key === "place" || key === "boundary" || AREA_TYPES.has(type) ? "area" : "place";
  const name = text(p.name) || (kind === "address" ? street : "") || text(p.street) || text(p.city) || query;
  const address = kind === "address" ? locality : kind === "street" ? [text(p.district), locality].filter(Boolean).join(", ")
    : [street, locality].filter(Boolean).join(", ");
  return [{
    kind, id: `osm:${text(p.osm_type)}:${text(p.osm_id)}`, name, coordinate,
    category: kind === "address" ? "house" : value, address,
    source: "Photon / OpenStreetMap", attributions: ["© OpenStreetMap contributors · ODbL"],
    distanceMeters: distanceMeters(center, coordinate),
  }];
}

const PHOTON_CACHE_MS = 5 * 60_000;
const cache = new Map<string, { at: number; places: Place[] }>();
/** One rate-limited, cached Photon lookup; the same text and rounded bias reuse the answer for five minutes. */
async function photon(text: string, bias: Coordinate, signal?: AbortSignal): Promise<Place[]> {
  const key = `${normalize(text)}:${bias.latitude.toFixed(3)}:${bias.longitude.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < PHOTON_CACHE_MS) return cached.places;
  const params = new URLSearchParams({ q: text, lat: String(bias.latitude), lon: String(bias.longitude), limit: "12" });
  const result = await request(
    () => fetchJSON<PhotonResponse>(`https://photon.komoot.io/api/?${params}`, { signal }, 'photon'),
    signal,
  );
  const places = parseServiceData('photon', () => {
    if (!Array.isArray(result.features))
      throw new ServiceError("Ricerca online: risposta non valida.", "invalid");
    return result.features.flatMap((feature) => photonPlace(feature, bias, text));
  });
  if (cache.size > 80) cache.clear();
  checkAbort(signal);
  cache.set(key, { at: Date.now(), places });
  return places;
}

/** The query without its neighbourhood words, keeping the typed spelling when it splits the same way. */
function withoutLocality(query: string, plan: QueryPlan): string {
  const span = plan.locality!;
  const raw = query.trim().split(/\s+/);
  const keep = raw.length === plan.tokens.length
    ? raw.filter((_, i) => i < span.start || i >= span.end)
    : plan.tokens.filter((_, i) => i < span.start || i >= span.end);
  return keep.filter((word, i) => !FILLER_WORDS.has(normalize(word)) || i > 0 && i < keep.length - 1).join(" ");
}

/**
 * Local results first, then Photon for names and addresses when online search is allowed. When
 * Photon finds nothing for a query that names a known neighbourhood ("Eataly Lingotto"), one more
 * lookup sends only the remaining words, biased to that neighbourhood's public OSM node instead of
 * the map centre, and keeps answers inside its approximate radius.
 */
export async function searchPlaces(
  query: string,
  options: SearchOptions,
): Promise<SearchResult> {
  checkAbort(options.signal);
  const q = query.trim();
  const matches = localMatches(q, options.center);
  const { plan } = matches;
  // Photon geocodes names and addresses; using it as category discovery returns unrelated distant names.
  // Stop codes and line names ("472", "M1", "fermata 472", "linea 4") are answered from the bundled GTT catalog.
  const transitOnly = isTransitQuery(q);
  const categoryOnly = plan.categoryTerms.length > 0 || plan.tokens.every((token, i) =>
    !plan.required[i] || !!aliases[token] || (!!plan.locality && i >= plan.locality.start && i < plan.locality.end));
  // Policy is checked before cache access too: opting out must never redisplay cached remote results.
  if (plan.normalized.length < 2 || options.policy === 'local-only' || categoryOnly || transitOnly) {
    checkAbort(options.signal);
    return localResult(matches);
  }
  let online: Place[] = [];
  try {
    online = await photon(q, options.center, options.signal);
    const remaining = plan.locality ? withoutLocality(q, plan) : "";
    if (!online.length && plan.locality && normalize(remaining).length >= 2) {
      const area = plan.locality.locality;
      online = (await photon(remaining, area.coordinate, options.signal))
        .filter((place) => distanceMeters(place.coordinate, area.coordinate) <= area.radiusMeters)
        .map((place) => ({ ...place, distanceMeters: distanceMeters(options.center, place.coordinate) }));
    } else online = online.map((place) => ({ ...place, distanceMeters: distanceMeters(options.center, place.coordinate) }));
  } catch (error) {
    checkAbort(options.signal);
    if (!matches.groups.length) throw error;
    return {
      ...localResult(matches),
      warnings: ["Ricerca online non disponibile. Mostriamo solo i luoghi del pacchetto locale."],
    };
  }
  checkAbort(options.signal);
  const merged = deduplicateGroups([...matches.groups, ...online.map((place) => ({ place, catalogIds: [] }))]);
  return {
    ...limitedPlaces(merged, ONLINE_RESULT_LIMIT, placeCatalog),
    warnings: [],
    source: "Overture Places locale · Photon / OpenStreetMap",
    coverage: matches.coverage,
  };
}
