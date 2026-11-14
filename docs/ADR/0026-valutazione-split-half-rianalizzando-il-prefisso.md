# ADR-0026: Valutazione split-half durante l'ascolto, rianalizzando l'audio raccolto

- **Stato:** Accettato (2026-11-13, dal product owner, dopo la revisione avversariale di I-07; decisione D-AF)
- **Data:** 2026-11-13
- **Decisori:** product owner

## Contesto

I-07 porta l'arresto anticipato di SPEC §8 e ADR-0008. La regola chiede una valutazione per ogni secondo di voce valida durante l'ascolto. Inoltre il limite dei 18 s di voce valida (`MAX_VALID_SPEECH`, SPEC §6.1) deve scattare davvero.

**Fatti verificati nel codice prima di I-07:**
- le misure di scheda e microfono si calcolavano una volta sola, a fine sessione, sull'audio tenuto in RAM (ADR-0025);
- la sessione mandava `validSpeechMs: 0` a ogni `TICK`, quindi `MAX_VALID_SPEECH` non scattava mai;
- l'evento `SPLIT_HALF_STABLE` esisteva nella macchina ma nessuno lo emetteva;
- il guadagno di normalizzazione (D-V) si calcola sul clip intero, prima del VAD: anche le decisioni del VAD dipendono da tutto il clip.

**Decisione del product owner D-AD (2026-11-13):** durante l'ascolto si rianalizza l'audio raccolto fino a quel momento, con la stessa funzione del risultato finale, invece di un calcolo a pezzi.

**Misure in Node** (2026-11-13, `pnpm bench:descriptors`, `docs/BENCHMARK_PROTOCOL.md` §7):
- su `voice-a-long` nessuna valutazione passa fino a 24 s di voce valida, e la sessione si chiude con `MAX_VALID_SPEECH`. Il blocco viene da due cause (revisione M-1):
  - **dal secondo 9 al 15 le metà sono incomplete**: ogni metà deve avere 20 onset (minimo di §7.4), cioè circa 40 nel prefisso; con 2,5–3 onset al secondo di voce valida ci vogliono circa 15 s;
  - **dal secondo 16 le metà differiscono di 8–17 punti**, contro τ = 6, soprattutto su p6 (ritmo) e p3 (dinamica);
- **decisione D-AE:** τ resta 6. La soglia si decide in G1 con le voci vere (I-08).

## Decisione

1. **Una valutazione a ogni secondo intero di audio sorgente.** Il `dsp-worker` della sessione (ADR-0025) analizza il prefisso di `k` secondi interi: libfvad in modo canonico, frame acustici con il guadagno di quel prefisso. Su quei frame osserva la regola.
   - Le valutazioni girano una alla volta, sempre in un task successivo a quello del blocco (rilievo H-2): i blocchi già in coda sulla porta entrano prima, e la valutazione analizza l'ultimo `k` disponibile, non il successivo. Così il ritardo non si accumula oltre una valutazione.
   - Da quell'analisi valuta in ordine ogni secondo intero di voce valida raggiunto dopo la valutazione precedente: il numero di valutazioni non dipende dalla velocità del PC.
   - **L'esito invece sì** (rilievo M-2): ogni prefisso ha il proprio guadagno e le proprie decisioni del VAD, quindi su un PC più lento, che analizza prefissi più lunghi, la stessa valutazione può dare un altro `s_t`. Misurato in Node: con una valutazione ogni 1, 2 o 3 s di audio, il controllo regolare converge a 13, 16 o 15 s.
2. **Voce valida = frame utili** (SPEC §7.4), come `qualitySummary`. Il secondo `m` è valutato sul prefisso che finisce col frame utile numero `100·m`.
3. **Le metà.** I frame utili del prefisso, in ordine, formano blocchi da 1 s: i blocchi pari vanno nella metà A, i dispari nella B.
   - Ogni metà si misura con le stesse formule e gli stessi minimi di §7.4. Sotto un minimo la misura è `null`, mai 0 (R13).
   - Gli onset si rilevano una volta sul prefisso, e ognuno conta nella metà del suo blocco. Così la distanza minima di 80 ms non si applica attraverso la cucitura di due blocchi incollati.
4. **Una valutazione passa** solo se, nell'ordine:
   1. il prefisso ha almeno 8 s di voce valida;
   2. il prefisso ha tutti e sei i descrittori sopra il minimo;
   3. nessun avviso «più voci» è in attesa di risposta. La risposta dell'utente (`MULTI_SPEAKER_ANSWER`) arriva solo con I-13: fino ad allora un avviso apparso una volta resta in attesa per tutta la sessione, e nessuna valutazione successiva passa (rilievo H-1: su una voce A seguita da una voce B le metà alternate contengono entrambe le voci e si somigliano, quindi solo l'avviso impedisce l'arresto);
      - **Aggiornamento di I-13b (D-AM, decisione del product owner, 2026-11-14):** la risposta arriva dal dialogo del pannello. «Sì, continua» vale per tutta la sessione: l'avviso non torna in attesa, anche se l'euristica scatta di nuovo, e l'arresto anticipato torna possibile; l'avviso resta fra quelli del risultato e sul cartellino. «No, interrompi» chiude la sessione con `INTERRUPTED` / `MULTI_SPEAKER_DECLINED`. Senza risposta vale la regola di sopra;
   4. le due metà misurano tutti e sei i descrittori;
   5. `s_t = max_i |a_i − b_i| ≤ τ`, in punti della tabella `mapping-0`.
5. **Arresto.** Servono `SPLIT_HALF_CONSECUTIVE` (3) valutazioni passate di fila; una non passata azzera il conteggio.
   - Alla convergenza il worker non valuta più. La sessione applica `SPLIT_HALF_STABLE` subito in `LISTENING`, oppure al primo `TICK` in `LISTENING` se è arrivata in una pausa.
   - Nessun arco nuovo della macchina.
6. **Limite dei 18 s.** La voce valida dell'ultima valutazione entra nel `TICK`, quindi `MAX_VALID_SPEECH` scatta.
7. **Il seed resta quello dell'analisi finale** del buffer intero (ADR-0025), cioè di tutto l'audio arrivato fino all'arresto. Dipende quindi dal momento dell'arresto: misurato su `voice-a-long`, 0,5–1 s di audio in più spostano p6 di circa 1 punto (rilievo C-1).
8. **Costanti** [H] in `packages/dsp-core/src/stop-config.ts`, versione `split-half-0`: blocco di 1 s, τ = 6 punti, 3 valutazioni.
   - Stanno fuori da `config.ts`: decidono quando ci si ferma, non che cosa misura l'estrattore. `extractorVersion` e i seed non cambiano.
9. **Al pannello** arrivano due campi nuovi del messaggio interno `CAPTURE_DIAG` (`validSpeechMs`, `stability`, con la versione della regola e il tempo dell'ultima valutazione), e due righe tecniche «sperimentali». `CaptureMessage` di SPEC §9 non cambia.
10. **Una valutazione fallita** non azzera nulla: la sessione tiene l'ultima voce valida e l'ultima stabilità, il worker smette di valutare e la sessione arriva ai suoi limiti di tempo (rilievo M-3).

## Conseguenze

- **Positive:**
  - la decisione di fermarsi usa lo stesso codice e lo stesso guadagno del risultato finale;
  - non servono un resampler con stato né un guadagno stimato in corsa;
  - la regola si simula in Node con gli stessi passi del worker (`tests/benchmarks/stop-simulation.ts`).
- **Negative:**
  - **costo:** ogni valutazione rianalizza tutto il prefisso. Misurato in Node: da 50 ms a 1 s di audio fino a circa 0,5 s a 31 s; in tutto circa 7,9 s di CPU per `voice-a-long`. Nel browser, su questo portatile: fino a 0,54 s headless e fino a 1,34 s con finestra a 33 s di audio (`docs/BENCHMARK_PROTOCOL.md` §7). Oltre 1 s per valutazione le valutazioni restano indietro: con la finestra, prima della correzione H-2, l'esito è arrivato 5,1 s dopo `FINALIZING` (0,5 s headless). Su PC più lenti il rischio è il tempo massimo di 15 s dell'analisi finale;
  - **memoria:** a ogni valutazione una copia del prefisso, più la mono e i 16 kHz; non misurata;
  - **tempi variabili:** nel browser il momento dell'arresto può variare fra corse diverse, perché l'audio arriva a blocchi e i prefissi analizzati dipendono dalla velocità; con il momento cambiano anche l'esito e il seed;
  - **con τ = 6 e `mapping-0` l'arresto anticipato quasi non scatta** sulle voci sintetiche (D-AE). Fino a G1 le sessioni si chiudono di solito a 18 s di voce valida.
  - **un tono puro conta come voce valida per libfvad:** si ferma a 18 s (`MAX_VALID_SPEECH`) e finisce in `INSUFFICIENT_DATA`, perché p6 non è misurabile.
- **Controllo positivo** (D-AE): una voce sintetica molto regolare converge dopo 10–12,5 s di voce valida. Ma p6 vi è saturo a 100 punti in entrambe le metà: il controllo prova la catena, non la soglia.
- **Specifica:** SPEC §8 dice «Costo: due stime aggiuntive al secondo». Con questa decisione il costo è un'analisi intera del prefisso al secondo; SPEC §8 ha una nota che rimanda qui (come per ADR-0024 in §7.4).
- **Versioni:** nessuna nuova di estrattore o mapping. Nuova `STOP_RULE_VERSION = 'split-half-0'`. `CAPTURE_DIAG` cambia forma (contratto interno).
- **Rivede ADR-0025:** la «conseguenza per I-07» (estrazione incrementale) non si applica; il calcolo a pezzi resta una proposta, se le misure di carico lo chiederanno.

## Alternative scartate

- **Calcolo a pezzi in corsa,** con guadagno e mono stimati: più leggero per la CPU, ma la decisione userebbe misure diverse da quelle finali e il lavoro raddoppia (D-AD).
- **Cambiare τ o togliere p6 dal confronto:** solo dati sintetici; si rischierebbe di tarare la regola sulla voce finta (D-AE, R15).
- **Rilevare gli onset su ogni metà incollata:** falsi vicini ai bordi dei blocchi.

## Verifica

- `packages/dsp-core/test/split-half.test.ts`: divisione in metà, onset ai bordi, minimi.
- `extension/test/split-half-rule.test.ts`: la regola con sequenze sintetiche (8 s, conteggio, τ esatto, «più voci»).
- `extension/test/i07-pieces.test.ts`: copia dell'accumulatore, valutatore (recupero, arresto, errore), guardia di `STREAM_PROGRESS`.
- `extension/test/capture-session.test.ts`: `CONVERGED`, `MAX_VALID_SPEECH`, convergenza in pausa, progressi in ritardo.
- `tests/unit/stop-rule-voices.test.ts` e `stop-rule-limits.test.ts`: motivi d'uscita sulle fixture.
- E2E: microfono finto e tono della scheda.
- Prove manuali M32–M34.

## Riferimenti

- **Specifica:** SPEC §6.1, §7.4, §8, §9.
- **ADR:** ADR-0008, ADR-0011, ADR-0014, ADR-0024, ADR-0025.
- **Backlog e decisioni:** `docs/BACKLOG.md` I-07 (D-AD, D-AE); `docs/BENCHMARK_PROTOCOL.md` §7.
