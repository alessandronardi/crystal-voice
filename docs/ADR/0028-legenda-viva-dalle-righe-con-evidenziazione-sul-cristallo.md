# ADR-0028: Legenda viva dalle righe, con evidenziazione sul cristallo

- **Stato:** Accettato (2026-11-14, dal product owner; decisione D-AU)
- **Data:** 2026-11-14
- **Decisori:** product owner

## Contesto

- **Il requisito:** SPEC §13 **[F]** (legenda viva): si seleziona un tratto del cristallo, oppure la riga corrispondente nella legenda testuale accessibile, e si legge la misura che l'ha generato. Esempio: «Zonatura: 4,1 onset/s, 68° percentile». I tratti velati riportano «confidenza bassa».
- **Il problema:** non tutti i tratti si possono selezionare in un punto del cristallo.
  - Il colore (p5) e le bande di zonatura (p6) appartengono a tutto il corpo.
  - Quando un elemento non esiste, non c'è nulla da cliccare: nessun cristallo secondario per p3, nessuna inclusione per p4, una sola banda per p6 (`veilIsVisible` in `packages/renderer-three/src/pure/look.ts`).
- **Fatti verificati** (2026-11-14):
  - ogni faccia della geometria porta la sua forma (`FacePlane.form`: `prism-a`, `prism-b`, `prism-c`, `pinacoid`), quindi prisma (p1) e terminazioni (p2) si distinguono;
  - i corpi `secondary` (p3) e le `inclusions` (p4) sono elementi separati.
- **La decisione del product owner** (D-AL, 2026-11-14, I-13b): le righe della legenda selezionano il tratto e lo evidenziano sul cristallo; il clic sul cristallo non seleziona nulla.

## Decisione

1. **La legenda è un elenco di sei righe**, una per descrittore, usabile da tastiera e da lettore di schermo.
2. **Ogni riga riporta:**
   - il nome del tratto;
   - la misura grezza con l'unità;
   - il percentile della taratura sperimentale (`mapping-0`);
   - «confidenza bassa» se il tratto è velato.
3. **Selezionando una riga, il tratto si evidenzia sulla vetrina 3D** quando l'elemento esiste:
   - le facce del prisma (p1);
   - le terminazioni (p2);
   - i secondari (p3);
   - le inclusioni (p4).
4. **Nessuna evidenziazione sul cristallo** per colore (p5) e bande (p6), che riguardano tutto il corpo, né quando l'elemento non esiste. Lo dice la riga: il rendering non inventa elementi (decisione del 2026-11-10).
5. **Il clic o il tocco sul cristallo non seleziona un tratto.**
6. **Senza WebGL** la tavola SVG non si evidenzia; le righe e le misure restano disponibili.

## Conseguenze

- **Positive:**
  - un solo modo di selezionare, già accessibile;
  - nessun puntamento 3D (raycasting) nel renderer, quindi meno codice e meno test su GPU;
  - colore e bande seguono la stessa regola degli altri tratti.
- **Negative:** la parte di SPEC §13 «selezionando un tratto del cristallo» non è coperta. Con l'accettazione di questo ADR, SPEC §13 riceve una nota che rimanda qui.
- **Versioni:** nessuna. La geometria e i contratti pubblici non cambiano.
- **Rischio residuo:** l'utente può provare a cliccare il cristallo e non ottenere nulla. Un testo vicino alla vetrina indica la legenda.

## Alternative scartate

- **Righe più clic sul cristallo** (selezione con il puntatore su prisma, terminazioni, secondari e inclusioni; colore e bande solo dalle righe): rispetta la SPEC alla lettera, ma costa circa un terzo della issue in codice 3D e test. Scartata dal product owner (D-AL).
- **Solo righe, senza legame visivo:** la legenda non sarebbe «viva».

## Verifica

- Test unit sul modello della legenda: misura, percentile, velo ed elemento mancante per ogni descrittore.
- E2E: selezionando una riga cambia lo stato evidenziato della vetrina, e lo stato si legge dal test.
- Prova manuale M38 del product owner su GPU reale.

## Riferimenti

- SPEC §10 (D3, tratti velati), §13 (legenda viva).
- ADR-0012 (vetrina), ADR-0014 (tratti velati).
- `docs/BACKLOG.md` I-13.
