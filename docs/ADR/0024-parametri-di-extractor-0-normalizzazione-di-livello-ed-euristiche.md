# ADR-0024: Parametri di `extractor-0-experimental`: livello normalizzato, Dinamica e Ritmo sui frame intonati, euristiche misurate

- **Stato:** Accettato (2026-11-12, dal product owner, dopo la revisione avversariale di I-06a). Le scelte D-T, D-U e D-V sono del product owner, prese in sessione su domande con le misure; questo ADR le scrive in forma verificabile
- **Data:** 2026-11-12
- **Decisori:** product owner

## Contesto

I-06a implementa in Node i sei descrittori di SPEC §7.4, la confidenza (§7.2, D3), le euristiche musica e più voci (§7.2) e il seed di `mapping-0-experimental` (§7.5). Il VAD è libfvad modo 2 (ADR-0023), che chiama «voce» ogni suono non silenzioso: la musica la devono fermare le euristiche.

**Fatti misurati** il 2026-11-12, `pnpm bench:descriptors`, Node 26.13.0, Windows 11, solo fixture sintetiche (`fixtures-1`), più sette segnali lunghi generati in memoria:

1. **Volume.** Misura esplorativa: script fuori dal repository, codice delle varianti non conservato. Con le formule alla lettera, la stessa voce A a +6 dB e a −6 dB si sposta fino a 7,0 punti su p3 (Dinamica), 2,6 su p6 (Ritmo) e 1,6 su p2 (Intonazione). La DoD di I-06 ammette 1 punto. Cause:
   - la soglia fissa di −60 dBFS del frame utile;
   - libfvad, che a volume basso scarta qualche frame ai bordi delle sillabe.
2. **Bimodalità.** Una sola voce sintetica ha un coefficiente di bimodalità di log2(f0) di 0,66 (voce A), oltre la soglia di 0,555. La sua intonazione è sinusoidale e passa più tempo agli estremi. Da sola, la regola di SPEC §7.2 scatterebbe su ogni voce.
3. **Altezza ferma.** L'indizio «altezza stabile entro ±25 cent per oltre 200 ms» copre il 12–15% dei frame utili della voce A pulita. Sulla musica sintetica copre quasi nulla: gli accordi non hanno un'altezza unica, e YIN non dà f0.
4. **Musica e tratti.** Con musica a −12 dB, rispetto alla voce A sola:
   - p2 si sposta fino a 10 punti, p3 fino a 20, p6 fino a 60 (meno tempo intonato, più attacchi);
   - p4 grezzo cresce di circa 20 volte, ma resta saturo vicino a 0 per le voci sintetiche;
   - p1 si sposta al massimo di 2 punti, p5 al massimo di 4.

## Decisione

**Precedenza (AGENTS.md §2):** questo ADR prevale esplicitamente su SPEC §7.2 (criterio più voci, peso della musica sulla confidenza) e su SPEC §7.4 (livello normalizzato; p3 e p6 sui frame intonati e loro minimi), nei punti 1–5 qui sotto. Il resto di SPEC §7.2–§7.5 resta valido.

1. **Livello normalizzato (D-V).**
   - Prima del VAD e dei frame, il segnale di analisi a 16 kHz si moltiplica per un solo guadagno per tutto il clip.
   - Il guadagno porta il P95 dell'RMS dei frame da 20 ms (quelli con energia) a −20 dBFS [H].
   - L'amplificazione massima è +40 dB [H], così il solo fruscio non sale al livello del parlato.
   - Il clipping si giudica sui campioni sorgente.
   - Il «−60 dBFS» del frame utile diventa quindi relativo al volume del clip.
2. **p3 e p6 sui frame intonati (D-V).** Modifica della definizione di SPEC §7.4:
   - p3 = P90 − P10 di `rmsDbfs` sui frame **intonati**;
   - p6 = onset per secondo di frame **intonati**;
   - minimi: p3 chiede 4 s di frame utili **e** 2 s di intonati; p6 chiede 20 onset **e** 2 s di intonati.
3. **Più voci (D-T).** `MULTI_SPEAKER_SUSPECTED` se vale una delle due condizioni:
   - **altezza:** con almeno 4 s di intonati, bimodalità > 0,555 **e** i due gruppi di altezze separati da una soglia unica (minima somma dei quadrati interna) hanno mediane distanti almeno 6 semitoni [H], con il gruppo minore ad almeno il 20% dei frame [H];
   - **centroide:** su blocchi di 1 s di voce utile, almeno 4 transizioni, e almeno il 60% [H] cambia la mediana di log2(centroide) di più di 0,3 ottave [H].
   L'avviso non abbassa la confidenza: decide l'utente (SPEC §7.2).
4. **Musica (SPEC §7.2).** Un frame utile porta un indizio se vale almeno una di queste condizioni:
   - **altezza ferma:** fa parte di 21 frame consecutivi con f0, tutti entro ±25 cent;
   - **energia armonica senza altezza unica:** fa parte di una serie di almeno 20 frame utili, non intonati, con flatness ≤ 0,05 [H];
   - **flusso periodico:** fa parte di una finestra di 4 s con autocorrelazione del flusso > 0,5 [H], a un ritardo fra 0,3 e 2 s.
   Quota = frame con indizio / frame utili. Oltre il 20% scatta `MIXED_AUDIO_UNCERTAIN`.
5. **Confidenza (D-U).**
   - `confidenza_i = copertura_i × (1 − quota_musica)` per p2, p3, p4 e p6, i tratti che la musica sposta secondo il fatto 4; per p1 e p5 vale la sola copertura.
   - `copertura_i = min(1, quantità / (2 × minimo))`: vale 0,5 esattamente al minimo; con due requisiti conta il più scarso.
   - Un tratto non misurabile ha confidenza 0, e la sua misura resta `null`.
   - Il velo e `INSUFFICIENT_DATA` seguono ADR-0014, senza regole nuove.
6. **Onset.**
   - Si usa il flusso spettrale (300–4000 Hz) diviso per la mediana della magnitudine di banda dei frame utili: la scala non dipende dal guadagno.
   - Sono candidati i frame utili con valore ≥ 0,3 [H]; si tengono prima i più grandi, ad almeno 80 ms l'uno dall'altro.
7. **Versione.**
   - Tutto questo, più libfvad modo 2, è `extractor-0-experimental`.
   - Un test fissa l'impronta di tutte le costanti numeriche di `packages/dsp-core/src/config.ts`.
   - `extractorVersion` vale `null` se il VAD non è quello canonico.

## Conseguenze

- **Misure dopo la decisione** (BENCHMARK_PROTOCOL §7, I-06a). Sono **in-sample**: le soglie sono state fissate guardando le stesse fixture (revisione H-2):
  - **±6 dB e 44,1/48 kHz:** al massimo 0,09 punti;
  - **rifiuti:** 19 casi su 19 senza cristallo: 12 fixture (silenzio, toni, sweep, rumore, impulsi, accordi) e 7 segnali lunghi da 30–40 s;
  - **voce + musica a −12 dB:** `MIXED_AUDIO_UNCERTAIN` in 5 varianti su 5;
  - **alternanza A/B:** `MULTI_SPEAKER_SUSPECTED` in 2 su 3, sotto il 90% della DoD. v2 (B a 150 Hz, formanti ×1,08) non viene rilevata;
  - **falsi allarmi:** nessun avviso sulle 10 voci singole pulite;
  - **compressione 4:1:** Δp3 = −8,5 dB (VC-10).
- **Positive:**
  - il cristallo non dipende dal volume di registrazione: lo stesso microfono, più o meno vicino, dà la stessa Dinamica;
  - la musica sola delle fixture (accordi sostenuti) non produce cristalli. **Non vale per le note brevi:** toni a impulsi e melodie con note da 80–190 ms danno un cristallo senza avvisi (revisione H-1, 5 casi su 5, tracciati con `it.fails`);
  - con molta musica si velano più tratti, fino a `INSUFFICIENT_DATA`.
- **Negative:**
  - si perde l'informazione di livello assoluto. Il «−60 dBFS» non è più assoluto, e un avviso `LOW_LEVEL` andrà calcolato dal guadagno applicato (fuori perimetro, «Proposte»);
  - p3 e p6 non sono più calcolati come scrive SPEC §7.4: la specifica va emendata se l'ADR viene accettato;
  - in I-06b, per scheda e microfono, il guadagno non è noto finché l'audio non è finito. Va stimato mentre arriva, oppure si ricalcola tutto sul buffer a 16 kHz in RAM (R1 lo consente). Il cristallo provvisorio può quindi differire da quello finale;
  - la voce A di 12 s esce con p6 velato: 22 onset, appena sopra i 20, e il 12% di falsi indizi musicali. La confidenza è 0,48, sotto 0,5;
  - con musica a −12 dB, 1 variante su 5 non dà cristallo (più di due tratti velati), 4 su 5 lo danno con l'avviso e almeno un velo.
- **Specifica:** SPEC §7.2 e §7.4 portano una nota che rimanda a questo ADR; il testo completo va riscritto alla prossima revisione della specifica.
- **Rischi residui:**
  - tutte le soglie [H] sono misurate su voci e musica sintetiche, e sugli stessi casi che servono da prova: vanno riprese al G1 con i dati di I-08, su un set separato;
  - **lacuna nota (H-1):** nessun indizio musicale coglie le note più brevi di 200 ms. Un indizio nuovo sarebbe una soglia [H] nuova, da misurare (R15);
  - l'indizio «flusso periodico» scatta solo su impulsi e sweep, mai sulle fixture di voce e musica;
  - la rilevazione di A/B v3 viene dal criterio del centroide, e la causa non è stabilita: B ha formanti solo ×1,03, quindi potrebbe dipendere dalle vocali e non dal parlante;
  - il criterio del centroide ha poco margine: una voce singola (voice-b) arriva al 50% di salti, contro la soglia del 60%;
  - VC-24: le soglie di classificazione (−60 dB, f0 ≥ 60 Hz, flatness, onset) possono cambiare decisione per 1–2 ULP fra motori JS. Il margine minimo misurato rispetto a un confine di arrotondamento del seed è 0,00035 unità, contro circa 10⁻¹² di un ULP. Il confronto vero Node contro pannello è in I-06b.

## Alternative scartate

- **SPEC alla lettera** (opzione A della domanda): Dinamica fino a 7 punti fra +6 e −6 dB, DoD non rispettata (misura esplorativa, codice non conservato).
- **Solo p3 e p6 sui frame intonati, senza normalizzazione** (opzione B): Dinamica 0 punti, ma a −6 dB p2 e p6 restano a 1,64 punti, per colpa del VAD (misura esplorativa, codice non conservato).
- **Bimodalità da sola:** scatta su ogni voce sintetica (fatto 2).
- **Rifare la voce sintetica** perché non sia bimodale: costruirebbe le fixture su misura dell'euristica, e cambierebbe tutte le misure di I-05.
- **Velare sempre e non rifiutare mai con la musica:** un brano senza voce potrebbe dare un cristallo (VC-11).
- **Escludere dai descrittori i frame «musicali»:** cambierebbe le formule di SPEC §7.4; si avvisa e si pesa invece sulla confidenza.

## Verifica

- **`tests/unit/descriptors-fixtures.test.ts`** (DoD di I-06a, fixture renderizzate in memoria):
  - invarianza;
  - rifiuti;
  - avvisi;
  - assenza di falsi allarmi sulle voci pulite;
  - compressione;
  - determinismo;
  - nessun `NaN`;
  - seed interi.
- **`packages/dsp-core/test/descriptors.test.ts`:**
  - formule;
  - onset;
  - euristiche;
  - guadagno;
  - property test;
  - impronta di versione.
- **`packages/calibration/test/mapping.test.ts`:** mappa monotona, half-even, tabelle valide.
- **`pnpm bench:descriptors`:** tabelle in `docs/BENCHMARK_PROTOCOL.md` §7, eseguite anche in CI.

## Riferimenti

- **Specifica:** SPEC §7.2, §7.3, §7.4, §7.5.
- **ADR:** ADR-0006, ADR-0014, ADR-0023.
- **Rischi:** VC-10, VC-11, VC-12, VC-13, VC-24.
- **Decisioni e backlog:** `docs/STATUS.md` (D-R…D-V), `docs/BACKLOG.md` I-06a.
