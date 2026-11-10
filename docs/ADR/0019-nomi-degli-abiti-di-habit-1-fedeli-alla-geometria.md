# ADR-0019: Nomi degli abiti di `habit-1` fedeli alla geometria; prismi ditrigonale e diesagonale veri rinviati

- **Stato:** Accettato
- **Data:** 2026-11-10
- **Decisori:** product owner (scelta in chat il 2026-11-10, rilievo L1 della revisione di I-10)

## Contesto

SPEC §10 descrive il cammino di `p1` come trigonale → ditrigonale → esagonale → esagonale smussato → diesagonale, e usa «prisma diesagonale» come esempio di cartellino.

In `habit-1` (I-10) il cammino si ottiene con tre famiglie di piani verticali a multipli di 30°, cioè combinando prismi del primo e del secondo ordine:

- lo stadio «ditrigonale» è un esagono con lati alternati lunghi e corti, con angoli interni tutti di 120°: un prisma trigonale smussato dall'altro prisma trigonale;
- lo stadio «diesagonale» è un dodecagono con angoli tutti di 150°: due prismi esagonali combinati.

In senso cristallografico stretto, il prisma ditrigonale {hk·0} e quello diesagonale hanno angoli che si alternano (diversi da 120° e 150°). La revisione avversariale (L1) ha segnalato che il cartellino sarebbe impreciso, e il G2 chiede credibilità mineralogica.

## Decisione

1. **Geometria invariata.** Il cammino di `habit-1` resta quello attuale: hash e seed dorati non cambiano.
2. **Nomi corretti** in `packages/crystal-core/src/habit-names.ts`:
   - «prisma ditrigonale» diventa **«prisma trigonale smussato»**;
   - «prisma diesagonale» diventa **«prisma esagonale doppio»**;
   - restano «prisma trigonale», «prisma esagonale», «prisma esagonale smussato».
3. **SPEC §10:** una nota sotto la tabella del mapping rimanda a questo ADR. Vale anche per gli esempi di cartellino della specifica.
4. **Lavoro futuro:** i prismi ditrigonale e diesagonale veri sono previsti in una versione futura della geometria (es. `habit-2`), annotata fra le proposte di `docs/STATUS.md`.

## Conseguenze

**Positive**
- I cartellini descrivono la forma che si vede.
- Nessun impatto su hash, continuità o robustezza: il nome è fuori dall'hash.

**Negative**
- Il cammino di `habit-1` non contiene le forme ditrigonale e diesagonale elencate fra le forme ammesse di SPEC §10. Restano ammesse, ma non sono ancora generate.
- Le forme vere richiedono facce ad angoli non multipli di 30°: una tabella trigonometrica versionata (ADR-0010), un nuovo cammino continuo di `p1` da tarare sulla continuità, un nuovo `geometryVersion` e il mantenimento di `habit-1`.

## Alternative scartate

- **Tenere i nomi della SPEC:** costo zero, ma l'etichetta è cristallograficamente imprecisa.
- **Generare subito le forme vere in `habit-1`:** lavoro grosso, che rischia la continuità appena tarata e ritarda I-11 e I-12.

## Verifica

- Test dei nomi lungo i cammini di `p1` e `p2` in `packages/crystal-core/test/generate.test.ts`.
- `pnpm test:golden`: gli hash dei 1.000 seed dorati restano identici.

## Riferimenti

SPEC §10 (Forme ammesse, Mapping geometrico, Cartellino); ADR-0005; ADR-0010; ADR-0018; revisione avversariale di I-10 (rilievo L1).
