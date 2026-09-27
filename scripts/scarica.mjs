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

// Il portale a volte non risponde ai server esteri: riprova fino a 5 volte
async function scarica() {
  for (let tentativo = 1; tentativo <= 5; tentativo++) {
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
      if (tentativo === 5) throw errore;
      await new Promise((attendi) => setTimeout(attendi, tentativo * 15_000));
    }
  }
}

const dati = await scarica();
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
    totale_portale: dati.response.numFound,
    response: { numFound: aperti.length, docs: aperti },
  }),
);
console.log(`Salvati ${aperti.length} incentivi aperti su ${dati.response.numFound} totali`);
