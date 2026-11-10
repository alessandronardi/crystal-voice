# Glossario

Termini usati in specifica, codice e interfaccia. Gli identificatori nel codice sono in inglese; i termini UI in italiano.

## Descrittori acustici

| Chiave codice | Nome UI | Cosa misura | Resa visiva |
|---|---|---|---|
| `p1_pitch` | Altezza | Mediana di log2(f0) | Cammino delle forme del prisma (3 → 6 → 12 facce) |
| `p2_intonation` | Variabilità d'intonazione | IQR di f0 in semitoni | Terminazioni (piramidi, romboedri) |
| `p3_dynamics` | Dinamica | P90 − P10 dei dBFS | Allungamento, cristalli secondari |
| `p4_roughness` | Ruvidità | Aperiodicità YIN mediana | Inclusioni aghiformi, fantasmi |
| `p5_brightness` | Brillantezza | Centroide 300–4000 Hz (poi residuo su f0) | Colore OKLCH rubino → zaffiro |
| `p6_rhythm` | Ritmo | Onset al secondo | Zonatura di crescita |

## Termini di dominio

| Termine | Significato |
|---|---|
| Seed | Sei interi in [0, 10000]; definisce il cristallo con `geometryVersion` |
| Unità di seed | Centesimo di punto: 10000 unità = 100 punti |
| Confidenza | Valore 0–1 per descrittore; sotto 0,5 il tratto è «velato» |
| Tratto velato | Elemento visivo attenuato perché il descrittore è poco affidabile |
| Frame utile | Frame con voce secondo il VAD, non clippato, sopra −60 dBFS |
| Frame intonato | Frame utile con f0 in 60–500 Hz e confidenza ≥ 0,8 |
| Split-half | Confronto delle stime sui blocchi pari e dispari di 1 s per decidere l'arresto |
| Abito | Forma complessiva del cristallo (habit), es. «prisma esagonale doppio con romboedro» |
| Semispazio | Regione `n·x ≤ d`; il cristallo è l'intersezione dei semispazi delle sue facce |
| Germe | Cristallo provvisorio mostrato durante l'ascolto |
| Esemplare | Cristallo salvato in collezione, con numero progressivo |
| Cartellino | Etichetta da collezione dell'esemplare |
| Tavola cristallografica | Disegno SVG a linee, deterministico |
| Vetrina | Resa 3D WebGL |
| Percentile di vicinanza | Quota di coppie di voci diverse di riferimento più lontane di quella confrontata |
| Pass-through | Reinstradamento dell'audio catturato verso le casse, perché la cattura lo silenzia |
| Heartbeat | Messaggio periodico del content script che tiene viva la sessione |

## Versioni

| Campo | Cambia quando | Prima versione |
|---|---|---|
| `extractorVersion` | Formule, finestre, soglie, VAD | `extractor-0-experimental` |
| `mappingVersion` | Tabelle quantili | `mapping-0-experimental`, poi `mapping-1` |
| `geometryVersion` | Qualunque output geometrico su un seed dorato | `habit-1` |
| `comparatorVersion` | Pesi o tabella G | `comparator-0-experimental`, poi `comparator-1` |
| `schemaVersion` | Struttura del record IndexedDB | `1` |

## Sigle

| Sigla | Significato |
|---|---|
| `[F]` `[H]` `[G]` `[P]` `[R]` | Fissato, ipotesi, gate, post-MVP, rischio residuo |
| VC-xx | Rilievo della revisione avversariale |
| I-xx | Issue del backlog |
| D1–D5 | Decisioni del product owner del 9 novembre 2026 |
| Δn | Modifica della v0.3 rispetto alla v0.2 |
