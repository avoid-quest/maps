import licenses from '../data/licenses.json';
import manifest from '../data/manifest.json';
import { mirrorHosts } from '../transit-data/config';
import { STOP_LIVE_DISCLOSURE, STOP_LIVE_SETTING } from '../transit-data/stop-live';
export const DATA_LICENSES = licenses;
export const DATA_MANIFEST = manifest;
export const PROVIDER_NOTICES = [
  { name: 'Mappe', text: 'OpenFreeMap · OpenMapTiles · © OpenStreetMap contributors', url: 'https://www.openstreetmap.org/copyright' },
  { name: 'Luoghi', text: `Overture Maps Foundation. Pacchetto di ${manifest.places.count.toLocaleString('it-IT')} record, release ${manifest.places.release}; estensione indicata dal confine tratteggiato sulla mappa. Dati incompleti; fonti e licenze conservate per ogni luogo.`, url: 'https://docs.overturemaps.org/attribution/' },
  { name: 'Ricerca online', text: 'Photon / OpenStreetMap: se la ricerca online è abilitata, nomi e indirizzi cercati e area vengono inviati al servizio. Le categorie sono cercate nel pacchetto locale. Nessuna disponibilità garantita.', url: 'https://photon.komoot.io' },
  { name: 'Percorsi stradali', text: 'FOSSGIS / OpenStreetMap: partenza e destinazione inviate al servizio e registrate nei log. Massimo una richiesta al secondo; servizio pubblico per uso moderato.', url: 'https://www.openstreetmap.org/fixthemap' },
  { name: 'Fermate e previsioni', text: `Data source: GTT S.p.A. – Gruppo Torinese Trasporti. Dati per uso non commerciale. Orari programmati GTT ${manifest.gtt.version} inclusi nell’app; versioni più recenti verificate tramite hash vengono scaricate da ${mirrorHosts().join(', ')} (il server vede indirizzo IP e ora della richiesta, non la fermata né la posizione). Il feed tempo reale è scaricato per l’intera città: non contiene la tua posizione né la fermata scelta.`, url: 'https://www.gtt.to.it' },
  { name: STOP_LIVE_SETTING, text: STOP_LIVE_DISCLOSURE, url: 'https://www.gtt.to.it' },
  { name: 'Orari GTT: identità delle corse', text: 'Quando GTT riassegna gli identificativi delle corse, l’app legge direttamente dall’archivio orari ufficiale GTT (www.gtt.to.it) solo l’elenco corse e i calendari, con richieste parziali condizionali al massimo una volta al giorno (con «Aggiorna orari», al massimo ogni 10 minuti) e solo con una bacheca aperta. Non invia fermata né posizione; GTT vede indirizzo IP e ora della richiesta.', url: 'https://www.gtt.to.it/open_data/gtt_gtfs.zip' },
  { name: 'Treni e ricerca su Transitous', text: 'Transitous (servizio comunitario, uso non commerciale) riceve solo su tua richiesta: il codice della stazione o fermata quando apri una bacheca treni o scegli «Cerca su Transitous», il codice della corsa quando ne apri le fermate, il testo digitato quando cerchi una fermata per nome. Mai la tua posizione. Transitous registra indirizzo IP, ora, URL della richiesta e User-Agent (nome e versione dell’app) e conserva i log fino a 2 giorni. Dati da BusOne (https://busone.app) and Trenitalia; BusOne (https://busone.app) and GTT. Fonti complete al link.', url: 'https://transitous.org/sources/' },
  { name: 'Viaggi pubblici', text: 'MATO / 5T: partenza e destinazione inviate al servizio. Integrazione sperimentale; licenza di riuso API, quote e continuità non verificate.', url: 'https://mato.muoversiatorino.it/' },
];
