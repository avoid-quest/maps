import licenses from '../data/licenses.json';
import manifest from '../data/manifest.json';
export const DATA_LICENSES = licenses;
export const DATA_MANIFEST = manifest;
export const PROVIDER_NOTICES = [
  { name: 'Mappe', text: 'OpenFreeMap · OpenMapTiles · © OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  { name: 'Luoghi', text: 'Overture Maps Foundation. Pacchetto Docks Dora / parte di Barriera di Milano. Fonti e licenze conservate per ogni luogo.', url: 'https://docs.overturemaps.org/attribution/' },
  { name: 'Ricerca online', text: 'Photon / OpenStreetMap: query e area di ricerca vengono inviate al servizio. Nessuna disponibilità garantita.', url: 'https://photon.komoot.io' },
  { name: 'Percorsi stradali', text: 'FOSSGIS / OpenStreetMap: partenza e destinazione inviate al servizio e registrate nei log. Massimo una richiesta al secondo; uso personale.', url: 'https://www.openstreetmap.org/fixthemap' },
  { name: 'Fermate e previsioni', text: 'Data source: GTT S.p.A. – Gruppo Torinese Trasporti. Dati per uso non commerciale. Il download del feed non contiene la tua posizione.', url: 'https://www.gtt.to.it' },
  { name: 'Viaggi pubblici', text: 'MATO / 5T: partenza e destinazione inviate al servizio. Integrazione sperimentale privata; licenza di riuso API, quote e continuità non verificate.', url: 'https://mato.muoversiatorino.it/' },
];
