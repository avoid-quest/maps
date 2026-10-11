import rawPlaces from "../data/places.json";
import type { Coordinate, Place, SearchOptions, SearchResult } from "../domain/types";
import { distanceMeters, normalize } from "./geo";
import { checkAbort, fetchJSON, parseServiceData, requestQueue, ServiceError } from "./network";
import { getPlaceCoverage, LOCAL_SEARCH_RADIUS_METERS } from "./place-coverage";
const request = requestQueue(1000);
const places = rawPlaces as (Place & { hierarchy: string[] })[];
const LOCAL_RESULT_LIMIT = 60;
const ONLINE_RESULT_LIMIT = 40;
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
export function categoryLabel(category?: string): string {
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
// Normalize once, rather than rebuilding names, addresses and taxonomy regexes on every keystroke.
const index = places.map((place) => {
  const name = normalize(place.name);
  const nameWords = words(name);
  const categories = [place.category, ...place.hierarchy].filter(
    (value): value is string => Boolean(value),
  );
  return {
    place, name, nameWords,
    allWords: [...nameWords, ...words(place.address ?? "")],
    categoryTerms: new Set(taxonomyTerms.filter((term) =>
      categories.some((category) =>
        // The combined pharmacy_and_drug_store family also contains general personal-care retailers.
        term === "pharmacy" ? category === term : `_${category}_`.includes(`_${term}_`),
      ),
    )),
  };
});

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

function localMatches(query: string, center: Coordinate) {
  const q = normalize(query);
  const tokens = words(q);
  const categoryTerms = aliases[q] ?? [];
  const coverage = getPlaceCoverage(center, categoryTerms.length ? LOCAL_SEARCH_RADIUS_METERS : null);
  if (q.length < 2) return { places: [] as Place[], coverage };
  const matches: { place: Place; rank: number; exactTokens: number; distance: number }[] = [];
  for (const entry of index) {
    let rank = 0;
    if (categoryTerms.length) {
      // A restaurant furniture supplier is not somewhere to eat, even if its name matches.
      if (categoryTerms.some((term) => entry.categoryTerms.has(term))) rank = 4;
    } else if (entry.name === q) rank = 5;
    else if (tokens.every((token) => entry.nameWords.some((word) => tokenMatches(token, word)))) rank = 4;
    else if (tokens.every((token) => entry.allWords.some((word) => tokenMatches(token, word)))) rank = 3;
    else if (tokens.every((token) => entry.nameWords.some((word) => tokenMatches(token, word) || oneTypo(token, word)))) rank = 2;
    if (!rank) continue;
    const distance = distanceMeters(center, entry.place.coordinate);
    if (categoryTerms.length && distance > LOCAL_SEARCH_RADIUS_METERS) continue;
    matches.push({
      place: { ...entry.place, distanceMeters: distance }, rank, distance,
      exactTokens: categoryTerms.length ? 0 : tokens.filter((token) => entry.nameWords.includes(token)).length,
    });
  }
  matches.sort((a, b) => b.rank - a.rank || b.exactTokens - a.exactTokens ||
    a.distance - b.distance || a.place.id.localeCompare(b.place.id));
  return { places: deduplicatePlaces(matches.map((match) => match.place)), coverage };
}

function localResult(matches: ReturnType<typeof localMatches>): SearchResult {
  return {
    places: matches.places.slice(0, LOCAL_RESULT_LIMIT),
    warnings: [], source: "Overture Places locale", coverage: matches.coverage,
    resultLimit: LOCAL_RESULT_LIMIT, truncated: matches.places.length > LOCAL_RESULT_LIMIT,
  };
}

export function searchLocalResult(query: string, center: Coordinate): SearchResult {
  return localResult(localMatches(query, center));
}

export function searchLocalPlaces(query: string, center: Coordinate): Place[] {
  return searchLocalResult(query, center).places;
}
/** Only matching names within 70 m merge; co-located independent tenants remain separate. */
export function deduplicatePlaces(input: Place[]): Place[] {
  const results: Place[] = [];
  const byId = new Map<string, Place>();
  const byName = new Map<string, Place[]>();
  for (const place of input) {
    const name = normalize(place.name);
    const existing = byId.get(place.id) ?? byName.get(name)?.find(
      (candidate) => distanceMeters(candidate.coordinate, place.coordinate) < 70,
    );
    if (!existing) {
      const next = { ...place };
      results.push(next);
      byId.set(place.id, next);
      const sameName = byName.get(name) ?? [];
      sameName.push(next);
      byName.set(name, sameName);
    } else {
      byId.set(place.id, existing);
      existing.attributions = [
        ...new Set([...existing.attributions, ...place.attributions]),
      ];
      existing.website ??= place.website;
      existing.phone ??= place.phone;
      existing.address ??= place.address;
      if (!existing.source.includes(place.source))
        existing.source += ` + ${place.source}`;
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
const cache = new Map<string, { at: number; places: Place[] }>();
export async function searchPlaces(
  query: string,
  options: SearchOptions,
): Promise<SearchResult> {
  checkAbort(options.signal);
  const q = query.trim();
  const matches = localMatches(q, options.center);
  // Photon geocodes names and addresses; using it as category discovery returns unrelated distant names.
  // Policy is checked before cache access too: opting out must never redisplay cached remote results.
  if (normalize(q).length < 2 || options.policy === 'local-only' || aliases[normalize(q)]) {
    checkAbort(options.signal);
    return localResult(matches);
  }
  const key = `${normalize(q)}:${options.center.latitude.toFixed(3)}:${options.center.longitude.toFixed(3)}`;
  let online: Place[] = [];
  try {
    const cached = cache.get(key);
    if (cached && Date.now() - cached.at < 5 * 60_000) online = cached.places;
    else {
      const params = new URLSearchParams({
        q,
        lat: String(options.center.latitude),
        lon: String(options.center.longitude),
        limit: "12",
      });
      const result = await request(
        () =>
          fetchJSON<PhotonResponse>(`https://photon.komoot.io/api/?${params}`, {
            signal: options.signal,
          }, 'photon'),
        options.signal,
      );
      online = parseServiceData('photon', () => {
        if (!Array.isArray(result.features))
          throw new ServiceError(
            "Ricerca online: risposta non valida.",
            "invalid",
          );
        return result.features.flatMap((f) => {
          if (!f.geometry?.coordinates || f.geometry.coordinates.length < 2)
            return [];
          const p = f.properties;
          const coordinate = {
            longitude: f.geometry.coordinates[0]!,
            latitude: f.geometry.coordinates[1]!,
          };
          return [
            {
              id: `osm:${p.osm_type}:${p.osm_id}`,
              name: String(p.name ?? p.street ?? p.city ?? q),
              coordinate,
              category: String(p.osm_value ?? ""),
              address: [p.street, p.housenumber, p.postcode, p.city]
                .filter(Boolean)
                .join(" "),
              source: "Photon / OpenStreetMap",
              attributions: ["© OpenStreetMap contributors · ODbL"],
              distanceMeters: distanceMeters(options.center, coordinate),
            },
          ];
        });
      });
      if (cache.size > 80) cache.clear();
      checkAbort(options.signal);
      cache.set(key, { at: Date.now(), places: online });
    }
  } catch (error) {
    checkAbort(options.signal);
    if (!matches.places.length) throw error;
    return {
      ...localResult(matches),
      warnings: ["Ricerca online non disponibile. Mostriamo solo i luoghi del pacchetto locale."],
    };
  }
  checkAbort(options.signal);
  const merged = deduplicatePlaces([...matches.places, ...online]);
  return {
    places: merged.slice(0, ONLINE_RESULT_LIMIT),
    warnings: [],
    source: "Overture Places locale · Photon / OpenStreetMap",
    coverage: matches.coverage, resultLimit: ONLINE_RESULT_LIMIT,
    truncated: merged.length > ONLINE_RESULT_LIMIT,
  };
}
