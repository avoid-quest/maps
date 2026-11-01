import { categoryLabel } from '../../services/search';

/**
 * Italian names for OpenStreetMap values returned by online search (Photon `osm_value`). Overture
 * categories keep the labels in services/search; anything unknown falls back to a generic word
 * instead of showing a raw English tag.
 */
const OSM_LABELS: Record<string, string> = {
  // Sights and culture
  attraction: 'Attrazione', museum: 'Museo', gallery: 'Galleria d’arte', arts_centre: 'Centro culturale', artwork: 'Opera d’arte',
  monument: 'Monumento', memorial: 'Memoriale', statue: 'Statua', castle: 'Castello', palace: 'Palazzo', ruins: 'Rovine',
  tower: 'Torre', viewpoint: 'Punto panoramico', fountain: 'Fontana', archaeological_site: 'Sito archeologico', zoo: 'Zoo',
  aquarium: 'Acquario', theme_park: 'Parco divertimenti', theatre: 'Teatro', cinema: 'Cinema', library: 'Biblioteca',
  place_of_worship: 'Luogo di culto', church: 'Chiesa', cathedral: 'Cattedrale', chapel: 'Cappella', basilica: 'Basilica',
  synagogue: 'Sinagoga', mosque: 'Moschea', bridge: 'Ponte', information: 'Informazioni turistiche',
  // Green space and sport
  park: 'Parco', garden: 'Giardino', playground: 'Parco giochi', nature_reserve: 'Riserva naturale', square: 'Piazza',
  sports_centre: 'Centro sportivo', stadium: 'Stadio', pitch: 'Campo sportivo', swimming_pool: 'Piscina', fitness_centre: 'Palestra',
  // Transport
  station: 'Stazione', halt: 'Fermata ferroviaria', platform: 'Banchina', bus_stop: 'Fermata bus', tram_stop: 'Fermata tram',
  bus_station: 'Autostazione', subway_entrance: 'Ingresso metro', parking: 'Parcheggio', bicycle_parking: 'Parcheggio bici',
  bicycle_rental: 'Bike sharing', fuel: 'Distributore', charging_station: 'Ricarica auto', taxi: 'Taxi', aerodrome: 'Aeroporto',
  // Services
  hospital: 'Ospedale', clinic: 'Ambulatorio', doctors: 'Medico', dentist: 'Dentista', pharmacy: 'Farmacia', veterinary: 'Veterinario',
  bank: 'Banca', atm: 'Bancomat', post_office: 'Ufficio postale', police: 'Polizia', fire_station: 'Vigili del fuoco',
  townhall: 'Municipio', courthouse: 'Tribunale', embassy: 'Ambasciata', community_centre: 'Centro civico', toilets: 'Servizi igienici',
  drinking_water: 'Acqua potabile', university: 'Università', college: 'Istituto', school: 'Scuola', kindergarten: 'Scuola dell’infanzia',
  // Food, lodging and shops
  restaurant: 'Ristorante', cafe: 'Caffè', bar: 'Bar', pub: 'Pub', fast_food: 'Fast food', ice_cream: 'Gelateria', food_court: 'Area ristoro',
  hotel: 'Hotel', hostel: 'Ostello', guest_house: 'Affittacamere', apartment: 'Appartamento', camp_site: 'Campeggio',
  supermarket: 'Supermercato', convenience: 'Minimarket', bakery: 'Panetteria', butcher: 'Macelleria', greengrocer: 'Fruttivendolo',
  clothes: 'Abbigliamento', shoes: 'Calzature', books: 'Libreria', mall: 'Centro commerciale', department_store: 'Grande magazzino',
  marketplace: 'Mercato', hairdresser: 'Parrucchiere', florist: 'Fiorista', newsagent: 'Edicola', tobacco: 'Tabaccheria',
  // Places and addresses
  city: 'Città', town: 'Comune', village: 'Paese', hamlet: 'Frazione', suburb: 'Quartiere', quarter: 'Quartiere',
  neighbourhood: 'Zona', locality: 'Località', house: 'Indirizzo', building: 'Edificio', residential: 'Via', primary: 'Strada',
  secondary: 'Strada', tertiary: 'Strada', unclassified: 'Strada', living_street: 'Via', pedestrian: 'Area pedonale',
  footway: 'Percorso pedonale', cycleway: 'Pista ciclabile', service: 'Strada di servizio', river: 'Fiume', stream: 'Torrente',
  canal: 'Canale', lake: 'Lago', peak: 'Vetta', hill: 'Collina', island: 'Isola',
};

/** Category values the app writes itself; they are already Italian. */
export const APP_CATEGORY_LABELS: ReadonlySet<string> = new Set(['Fermata GTT']);

const GENERIC = 'Attività';

/** A specific Italian label, the generic business family, or null when the value is unknown. */
function knownLabel(value: string): string | null {
  const osm = OSM_LABELS[value.toLowerCase()];
  if (osm) return osm;
  const overture = categoryLabel(value);
  return overture !== value ? overture : null;
}

/**
 * An Italian label for a place category. Multi-value provider tags (`bar;restaurant`) use the first
 * value with a known label; any other untranslated provider value becomes "Luogo".
 */
export function placeCategoryLabel(category: string | null | undefined): string {
  const value = category?.trim();
  if (!value) return 'Luogo';
  if (APP_CATEGORY_LABELS.has(value)) return value;
  let generic = false;
  for (const part of value.split(/[;,|]/).map(item => item.trim()).filter(Boolean)) {
    const label = knownLabel(part);
    if (label === GENERIC) generic = true;
    else if (label) return label;
  }
  return generic ? GENERIC : 'Luogo';
}
