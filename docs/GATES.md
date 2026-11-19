# Gate di avanzamento

Un gate è superato solo con un **verbale** in `docs/gates/<gate>-<AAAA-MM-GG>.md` che contiene: checklist con esito di ogni voce, evidenze (file, numeri, screenshot), rilievi della revisione avversariale indipendente, decisione del product owner.

**Regole comuni**

- La revisione è svolta da un agente o da una persona che **non** ha scritto il codice in esame (`.claude/agents/adversarial-reviewer.md`).
- Una voce senza evidenza vale «non superata». «Non eseguito» è un esito ammesso solo se il verbale dice chi lo eseguirà e quando.
- Esiti: **GO**, **CONDITIONAL GO** (con elenco di condizioni e scadenza), **NO-GO**.
- Il product owner firma la decisione. Un agente non può dichiarare un gate superato.

## G-PoC — fine fase 1

**Domanda:** la cattura in Chrome reale è affidabile e innocua per il player?

- [ ] I-01, I-02, I-03, I-17, I-18 chiuse.
- [ ] 30 avvii consecutivi senza audio muto o doppio.
- [ ] Pausa 60 s: sessione viva (ADR-0003).
- [ ] Navigazione esterna: stop ≤ 3 s (ADR-0004).
- [ ] Service worker terminato durante la cattura: stop e risultato funzionano.
- [ ] 100 cicli start/stop senza crash, memoria entro soglia.
- [ ] Ritardo del pass-through misurato.
- [ ] Microfono funzionante con il percorso scelto (offscreen o pagina visibile, con ADR).

**NO-GO se:** impossibile garantire pass-through o stop pulito in Chrome reale (SPEC §16).

## G1 — fine fase 2 (**CHIUSO PER DEROGA — ADR-0030**)

> **Deroga del product owner (2026-11-15, [ADR-0030](ADR/0030-rinuncia-calibrazione-g1-e-rimozione-stato-sperimentale.md)):** `I-08` (dataset umano) e `I-09` (tabelle `mapping-1` / `comparator-1`) sono rinunciate; le formule `extractor-0`, `mapping-0` e `comparator-0` restano invariate senza designazione «sperimentale». Le voci statistiche su popolazione umana sotto riportate non si eseguono.

**Domanda storica:** i sei descrittori sono abbastanza stabili e informativi da giustificare la promessa del prodotto?

- [~] I-08, I-09 rinunciate (ADR-0030); I-04…I-07 completate.
- [~] Metriche di `docs/BENCHMARK_PROTOCOL.md` su fixture sintetiche registrate; dataset umano non raccolto (ADR-0030).
- [~] Stabilità intra-parlante: non misurata su volontari (rinuncia ADR-0030).
- [~] Separazione: non misurata su volontari (rinuncia ADR-0030).
- [~] Arresto anticipato: non misurato su volontari (rinuncia ADR-0030).
- [~] Matrice di correlazione dei descrittori: non misurata su volontari (rinuncia ADR-0030).
- [x] `extractor-0`, `mapping-0` e `comparator-0` congelati dal product owner con ADR-0030 (rimossa designazione «sperimentale»).

**Se i risultati sono insufficienti:** ridimensionare la promessa (modalità «sperimentale» esplicita, testi UI rivisti) invece di alzare soglie a posteriori. **NO-GO se** il parlato non si distingue dalla musica al livello minimo, o se i seed cambiano molto per perturbazioni innocue senza spiegazione.

## G2 — fine fase 3

**Domanda:** la geometria è riproducibile, continua, credibile e bella?

- [ ] I-10, I-11, I-12 chiuse.
- [ ] Hash dei 1.000 seed dorati identici in Node, Chrome, Firefox.
- [ ] Continuità dimostrata dal property test.
- [ ] Revisione estetica del catalogo di 200 seed: varietà, credibilità mineralogica, assenza di forme ripetitive o grottesche; esito annotato nel verbale da una persona.
- [ ] Tavola SVG byte-identica; fallback senza WebGL funzionante.
- [ ] Schema `CrystalGeometry` congelato in `habit-1`.

## G0 — legale e distribuzione (obbligatorio prima di qualunque distribuzione)

> Da ADR-0027 (2026-11-13): le fasi 4 e 5 si sviluppano prima di G0; G0 blocca la pubblicazione, i pacchetti e ogni consegna a terzi, ed è richiesto dal gate Release.

**Domanda:** con quale canale e quali sorgenti si può distribuire?

- [x] `docs/LEGAL_G0_CHECKLIST.md` compilata: fascicolo `docs/gates/G0-fascicolo-legale.md` e registro §6 (2026-11-13).
- [x] Valutazione documentata sui Termini YouTube, sul diritto applicabile e sulle policy del Chrome Web Store: `docs/gates/G0-valutazione-2026-11-13.md`, scritta da un agente IA di revisione legale e accettata dal product owner (D-AH), **senza parere firmato di un avvocato**.
- [x] Valutazione privacy (dati di terzi, etichette dei parlanti, export): §3.2 e §3.6 della valutazione IA (D-AH), con prescrizioni G0-TECH-01/02 e G0-DOC-04.
- [x] Esito scelto fra: (a) estensione con entrambe le sorgenti; (b) estensione con sola «La tua voce»; (c) web app con il solo nucleo: **(a) condizionato**, fallback (b) (valutazione §6, accettata dal product owner, D-AH).
- [x] `docs/STATUS.md` aggiornato con l'esito (2026-11-13). **Distribuzione bloccata finché le prescrizioni non sono completate.**
- [x] Tutte le prescrizioni tecniche e documentali risolte (10/10, inclusa la non applicabilità di `G0-DOC-04`). I-16 attua `G0-TECH-03` con ADR-0031.
- [x] Visto formale di Alessandro Nardi registrato il 2026-11-19 sul commit `d43e7bd` (ADR-0027). [Verbale G0](gates/G0-2026-11-19.md)

Decisione del product owner D-AH (2026-11-13): la valutazione G0 si fa con un agente IA dedicato alla revisione legale, accettata dal product owner, **senza il parere firmato di un avvocato**. Non è un parere legale professionale: la responsabilità della distribuzione resta del product owner. Gli agenti di sviluppo preparano materiali e domande; le conclusioni sono dell'agente di revisione legale e del product owner. **La distribuzione resta bloccata finché il visto di chiusura di tutte le prescrizioni non è registrato nel verbale finale.**

## Release — fine fase 5

- [ ] I-13…I-16 chiuse *(I-16 completata tecnicamente lato codice/SBOM/E2E; in attesa di verifica manuale su 3 OS e revisione avversariale per chiusura definitiva)*.
- [ ] Revisione avversariale di release con verdetto GO *(non eseguita in questa sessione: richiede revisore indipendente, R14)*.
- [ ] Verifica manuale su tre sistemi operativi *(non eseguita in questa sessione su Windows, macOS e Linux in Chrome stabile, R14)*.
- [ ] Nessuna chiamata di rete in runtime. I test Playwright intercettano le richieste durante il percorso completo della build. Resta la verifica manuale nel pannello Network di Chrome stabile.
- [x] Nessun PCM in storage o log (ispezione di IndexedDB, `chrome.storage`, console) *(verificato automaticamente in `tests/e2e/release-hardening.spec.ts`, `tests/e2e/vault.spec.ts` e `tests/e2e/file.spec.ts`: `chrome.storage.session`, `chrome.storage.local`, IndexedDB `voicecrystal` e log console privi di PCM, `streamId` e metadati URL/YouTube)*.
- [ ] Accessibilità: axe-core senza violazioni serie; prova da tastiera e con screen reader *(axe-core 0 violazioni serie/critiche verificato in E2E su Home con licenze espanse, ascolto, dialogo più voci, rivelazione, esito, `collection.html` + dettaglio + confronto e `permission.html`; prova manuale da tastiera e screen reader non eseguita, R14)*.
- [ ] Informativa privacy e scheda dello store coerenti con il comportamento. I test verificano l’informativa e l’avviso Home. Resta il controllo della scheda finale dello store.

## Modello di verbale

```markdown
# Verbale <gate> — <data>

- Commit esaminato: <sha>
- Revisore indipendente: <agente/persona>
- Esito proposto: GO | CONDITIONAL GO | NO-GO

## Checklist
| Voce | Esito | Evidenza |
|---|---|---|

## Rilievi della revisione
| ID | Severità | Descrizione | Azione |
|---|---|---|---|

## Condizioni (se CONDITIONAL GO)

## Decisione del product owner
Esito: … — Firma: … — Data: …
```
