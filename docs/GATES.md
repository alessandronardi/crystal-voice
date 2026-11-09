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

## G1 — fine fase 2

**Domanda:** i sei descrittori sono abbastanza stabili e informativi da giustificare la promessa del prodotto?

- [ ] I-04…I-09 chiuse; report in `docs/reports/G1-report.md`.
- [ ] Tutte le metriche di `docs/BENCHMARK_PROTOCOL.md` riportate, con dataset e procedura.
- [ ] Stabilità intra-parlante: cambio di forma principale ≤ 10% delle coppie [H].
- [ ] Separazione: percentile mediano intra-parlante ≥ 70, inter-parlante ≈ 50 [H].
- [ ] Arresto anticipato: differenza dal seed a 18 s ≤ 5 punti nel 90% dei casi [H].
- [ ] Matrice di correlazione dei descrittori: nessuna coppia con |r| > 0,5 [H], o deroga motivata.
- [ ] `mapping-1`, `comparator-1`, soglie e tempi congelati con motivazione.

**Se i risultati sono insufficienti:** ridimensionare la promessa (modalità «sperimentale» esplicita, testi UI rivisti) invece di alzare soglie a posteriori. **NO-GO se** il parlato non si distingue dalla musica al livello minimo, o se i seed cambiano molto per perturbazioni innocue senza spiegazione.

## G2 — fine fase 3

**Domanda:** la geometria è riproducibile, continua, credibile e bella?

- [ ] I-10, I-11, I-12 chiuse.
- [ ] Hash dei 1.000 seed dorati identici in Node, Chrome, Firefox.
- [ ] Continuità dimostrata dal property test.
- [ ] Revisione estetica del catalogo di 200 seed: varietà, credibilità mineralogica, assenza di forme ripetitive o grottesche; esito annotato nel verbale da una persona.
- [ ] Tavola SVG byte-identica; fallback senza WebGL funzionante.
- [ ] Schema `CrystalGeometry` congelato in `habit-1`.

## G0 — legale e distribuzione (obbligatorio prima della fase 4)

**Domanda:** con quale canale e quali sorgenti si può distribuire?

- [ ] `docs/LEGAL_G0_CHECKLIST.md` compilata.
- [ ] Parere documentato di un professionista qualificato sui Termini YouTube, sul diritto applicabile e sulle policy del Chrome Web Store.
- [ ] Valutazione privacy (dati di terzi, etichette dei parlanti, export).
- [ ] Esito scelto fra: (a) estensione con entrambe le sorgenti; (b) estensione con sola «La tua voce»; (c) web app con il solo nucleo.
- [ ] `docs/STATUS.md` aggiornato con l'esito.

Nessun agente esprime pareri legali: prepara materiali e domande, non conclusioni.

## Release — fine fase 5

- [ ] I-13…I-16 chiuse.
- [ ] Revisione avversariale di release con verdetto GO.
- [ ] Verifica manuale su tre sistemi operativi.
- [ ] Nessuna chiamata di rete in runtime (verifica con il pannello Network e con un test automatico che intercetta le richieste).
- [ ] Nessun PCM in storage o log (ispezione di IndexedDB, `chrome.storage`, console).
- [ ] Accessibilità: axe-core senza violazioni serie; prova da tastiera e con screen reader.
- [ ] Informativa privacy e scheda dello store coerenti con il comportamento.

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
