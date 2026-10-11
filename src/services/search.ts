import rawPlaces from "../data/places.json";
import type { Coordinate, Place, SearchResult } from "../domain/types";
import { distanceMeters, normalize } from "./geo";
import { checkAbort, fetchJSON, requestQueue, ServiceError } from "./network";
const request = requestQueue(1000);
const places = rawPlaces as (Place & { hierarchy: string[] })[];
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
  hamburger: ["burger", "american_restaurant", "fast_food"],
  burger: ["burger", "american_restaurant"],
  bar: ["bar", "cafe", "coffee"],
  caffe: ["cafe", "coffee"],
  "wine bar": ["wine_bar", "bar"],
  negozi: ["shopping"],
  negozio: ["shopping"],
  supermercato: ["supermarket", "grocery", "discount_store"],
  supermercati: ["supermarket", "grocery"],
  abbigliamento: ["fashion", "clothing", "apparel"],
  farmacia: ["pharmacy"],
  gelato: ["ice_cream", "gelato"],
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
const words = (value: string) =>
  normalize(value)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
export function searchLocalPlaces(query: string, center: Coordinate): Place[] {
  const q = normalize(query);
  if (!q) return [];
  const tokens = words(q);
  const categoryTerms = aliases[q] ?? [];
  return places
    .map((place) => {
      const name = normalize(place.name);
      const haystack = normalize(`${place.name} ${place.address ?? ""}`);
      const categories = [place.category, ...place.hierarchy].filter(
        (value): value is string => Boolean(value),
      );
      const exact = name === q;
      const nameWords = words(name);
      const nameMatch = tokens.every((t) =>
        nameWords.some((word) => word.startsWith(t)),
      );
      const category = categoryTerms.some((term) =>
        categories.some((value) => new RegExp(`(^|_)${term}(_|$)`).test(value)),
      );
      const distance = distanceMeters(center, place.coordinate);
      // Category intents use the taxonomy: a restaurant furniture supplier is not somewhere to eat.
      const matched = categoryTerms.length
        ? category && distance <= 5000
        : exact ||
          nameMatch ||
          tokens.every((t) =>
            words(haystack).some((word) => word.startsWith(t)),
          );
      return {
        place: { ...place, distanceMeters: distance },
        matched,
        score:
          (categoryTerms.length ? 45 : exact ? 100 : nameMatch ? 65 : 20) +
          (place.confidence ?? 0.5) * 2 -
          Math.min(distance / 200, 35),
      };
    })
    .filter((p) => p.matched)
    .sort((a, b) => b.score - a.score)
    .map((p) => p.place)
    .slice(0, 60);
}
/** Only matching names within 70 m merge; co-located independent tenants remain separate. */
export function deduplicatePlaces(input: Place[]): Place[] {
  const results: Place[] = [];
  for (const place of input) {
    const existing = results.find(
      (p) =>
        p.id === place.id ||
        (normalize(p.name) === normalize(place.name) &&
          distanceMeters(p.coordinate, place.coordinate) < 70),
    );
    if (!existing) results.push({ ...place });
    else {
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
  options: { center: Coordinate; signal?: AbortSignal },
): Promise<SearchResult> {
  checkAbort(options.signal);
  const q = query.trim();
  if (q.length < 2) return { places: [], warnings: [], source: "Locale" };
  const local = searchLocalPlaces(q, options.center);
  const key = `${normalize(q)}:${options.center.latitude.toFixed(3)}:${options.center.longitude.toFixed(3)}`;
  // Photon geocodes names and addresses; using it as category discovery returns unrelated distant names.
  if (aliases[normalize(q)])
    return {
      places: local,
      warnings: local.length
        ? []
        : [
            "Le categorie del pacchetto locale coprono Docks Dora e parte di Barriera di Milano. Puoi cercare un nome o un indirizzo anche altrove.",
          ],
      source: "Overture Places locale",
    };
  let online: Place[] = [];
  const warnings: string[] = [];
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
          }),
        options.signal,
      );
      if (!Array.isArray(result.features))
        throw new ServiceError(
          "Ricerca online: risposta non valida.",
          "invalid",
        );
      online = result.features.flatMap((f) => {
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
      if (cache.size > 80) cache.clear();
      cache.set(key, { at: Date.now(), places: online });
    }
  } catch (error) {
    checkAbort(options.signal);
    if (!local.length) throw error;
    warnings.push(
      "Ricerca online non disponibile. Mostriamo solo i luoghi salvati nel pacchetto Docks Dora / Barriera.",
    );
  }
  return {
    places: deduplicatePlaces([...local, ...online]).slice(0, 40),
    warnings,
    source: "Overture Places locale · Photon / OpenStreetMap",
  };
}
