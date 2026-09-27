// Scarica ogni giorno gli incentivi aperti dal portale incentivi.gov.it
// Dati: MIMIT - licenza Italian Open Data License (IODL) 2.0
import { mkdir, writeFile } from 'node:fs/promises';

// Nome del campo nel nostro file : nome del campo nel portale
const CAMPI = {
  ID_Incentivo: 'zs_nid',
  Titolo: 'zs_title',
  Obiettivo_Finalita: 'zm_field_scopes_value',
  Data_apertura: 'zs_field_open_date',
  Data_chiusura: 'zs_field_close_date',
  Note_di_apertura_chiusura: 'zs_field_close_date_descriptor',
  Dimensioni: 'zm_field_dimensions_value',
  Tipologia_Soggetto: 'zm_field_subject_type_value',
  Forma_agevolazione: 'zm_field_support_form_value',
  Costi_Ammessi: 'zm_field_granted_costs_value',
  Agevolazione_Concedibile_min: 'zs_field_support_grant_type_min',
  Agevolazione_Concedibile_max: 'zs_field_support_grant_type_max',
  Settore_Attivita: 'zm_field_activity_sector_value',
  Codici_ATECO: 'zs_field_ateco',
  Regioni: 'zm_field_regions_value',
  Comuni: 'zs_field_comuni',
  Ambito_territoriale: 'zm_field_special_territory_value',
  Soggetto_Concedente: 'zs_field_subject_grant',
  Stanziamento_incentivo: 'zs_field_budget_allocation',
  Link_istituzionale: 'zs_field_link',
  Data_ultimo_aggiornamento: 'ds_last_update',
};

const parametri = new URLSearchParams({
  'q.op': 'OR',
  wt: 'json',
  rows: '10000',
  fl: Object.entries(CAMPI).map(([nostro, portale]) => `${nostro}:${portale}`).join(','),
  q: 'index_id:incentivi',
});
const INDIRIZZO = `https://www.incentivi.gov.it/solr/coredrupal/select?${parametri}`;

// Il portale a volte non risponde ai server esteri: riprova fino a 3 volte
async function scarica() {
  for (let tentativo = 1; tentativo <= 3; tentativo++) {
    try {
      const risposta = await fetch(INDIRIZZO, {
        headers: {
          'User-Agent': 'CatalogoBandi/1.0 (riuso open data IODL 2.0; aggiornamento giornaliero)',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(120_000),
      });
      if (!risposta.ok) throw new Error(`HTTP ${risposta.status}`);
      const dati = await risposta.json();
      if (!dati?.response?.docs?.length) throw new Error('risposta vuota');
      return dati;
    } catch (errore) {
      console.warn(`Tentativo ${tentativo} fallito: ${errore.message}`);
      if (tentativo === 3) throw errore;
      await new Promise((attendi) => setTimeout(attendi, tentativo * 15_000));
    }
  }
}

// Piano di riserva: se il portale rifiuta la connessione, usa la copia pubblica
// del progetto open source Radar Bandi (stessi dati, stessa licenza IODL 2.0)
const RISERVA = 'https://raw.githubusercontent.com/Marco1478/radar-bandi/main/data/bandi.json';
const lista = (x) => (Array.isArray(x) ? x : x ? [x] : []);

async function scaricaRiserva() {
  const risposta = await fetch(RISERVA, { signal: AbortSignal.timeout(120_000) });
  if (!risposta.ok) throw new Error(`riserva HTTP ${risposta.status}`);
  const r = await risposta.json();
  const docs = (r.bandi || []).map((b) => ({
    ID_Incentivo: String(b.id ?? ''),
    Titolo: b.title || '',
    Obiettivo_Finalita: lista(b.scopes),
    Data_apertura: b.open || null,
    Data_chiusura: b.close || null,
    Note_di_apertura_chiusura: b.closeNote || '',
    Dimensioni: lista(b.sizes),
    Tipologia_Soggetto: lista(b.subjects),
    Forma_agevolazione: lista(b.forms),
    Costi_Ammessi: lista(b.costs),
    Agevolazione_Concedibile_min: b.aiutoMin || '',
    Agevolazione_Concedibile_max: b.aiutoMax || '',
    Settore_Attivita: lista(b.sectors),
    Codici_ATECO: b.ateco || '',
    Regioni: lista(b.regions),
    Comuni: b.comuni && b.comuni !== 'Tutti' ? b.comuni : '',
    Ambito_territoriale: lista(b.territory),
    Soggetto_Concedente: b.ente || '',
    Stanziamento_incentivo: b.budget || '',
    Link_istituzionale: b.link || b.portal || '',
    Data_ultimo_aggiornamento: b.updated || '',
  }));
  console.log(`Copia di riserva generata il ${r.meta?.generated}`);
  return { origine: `copia Radar Bandi del ${r.meta?.generated}`, response: { numFound: r.meta?.totalInCatalog ?? docs.length, docs } };
}

let dati;
try {
  dati = await scarica();
  dati.origine = 'portale incentivi.gov.it (diretto)';
} catch (errore) {
  console.warn(`Portale non raggiungibile (${errore.message}): uso la copia di riserva`);
  dati = await scaricaRiserva();
}
const oggi = new Date().toISOString().slice(0, 10);
const primo = (x) => (Array.isArray(x) ? x[0] : x);

// Tiene solo gli incentivi non ancora chiusi (o senza data di chiusura)
const aperti = dati.response.docs.filter((d) => {
  const chiusura = primo(d.Data_chiusura);
  return !chiusura || String(chiusura).slice(0, 10) >= oggi;
});

await mkdir('data', { recursive: true });
await writeFile(
  'data/incentivi.json',
  JSON.stringify({
    generato: new Date().toISOString(),
    fonte: 'incentivi.gov.it (MIMIT) - licenza IODL 2.0',
    origine: dati.origine,
    totale_portale: dati.response.numFound,
    response: { numFound: aperti.length, docs: aperti },
  }),
);
console.log(`Salvati ${aperti.length} incentivi aperti su ${dati.response.numFound} totali`);
