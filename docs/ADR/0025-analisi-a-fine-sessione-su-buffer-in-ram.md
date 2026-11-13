# ADR-0025: Analisi di scheda e microfono a fine sessione, sull'audio tenuto in RAM

- **Stato:** Accettato (2026-11-13, dal product owner, dopo la revisione avversariale di I-06b; decisione D-AC)
- **Data:** 2026-11-12
- **Decisori:** product owner

## Contesto

I-06b porta l'estrattore `extractor-0-experimental` (I-06a, ADR-0024) nelle tre sorgenti. Il product owner ha deciso di includere scheda e microfono (D-W), oltre ai file locali.

**Fatti verificati nel codice prima di I-06b:**
- il worklet (`pcm-processor.ts`) contava solo i campioni e non mandava audio a nessuno;
- la regola d'arresto split-half (I-07) non esiste: una sessione arriva in `FINALIZING` solo per `WALL_TIMEOUT` (45 s di ascolto) o `ABSOLUTE_TIMEOUT` (120 s). Con `USER_STOP` va in `INTERRUPTED` (SPEC §6.1);
- per i file, il `dsp-worker` riceve già il buffer intero (ADR-0022).

**Vincoli:**
- R1: audio solo in RAM;
- ADR-0004: un'unica uscita, con la pulizia;
- D-V: il guadagno di normalizzazione si calcola sul clip intero;
- la DoD di I-06b chiede che l'estrazione a blocchi coincida con quella a buffer intero.

## Decisione

1. **Un `dsp-worker` per sessione**, creato dall'offscreen. Con l'AudioWorklet parla su un `MessageChannel` proprio.
2. **Il worklet inoltra l'audio** in blocchi da 4096 campioni per canale, trasferiti e non copiati, **solo negli stati di ascolto** (`LISTENING`, `WAITING_FOR_SPEECH`). Nelle pause non inoltra nulla, perché le pause non fanno parte del segmento (SPEC §7.2).
3. **Il worker accoda i blocchi alla frequenza sorgente**, con un tetto di 125 s per canale [H]. I blocchi oltre il tetto, o con un numero di canali diverso, sono rifiutati e contati (`droppedFrames`, in frame da 10 ms).
4. **In `FINALIZING`** l'offscreen chiede l'analisi.
   - Il segnale di fine passa dal worklet, sullo stesso canale e dopo l'ultimo blocco: nessun pezzo arriva dopo la fine.
   - Il worker concatena i blocchi ed esegue la stessa funzione dei file (`analyzeDescriptors`), a buffer intero.
5. **All'ingresso in `FINALIZING` la cattura finisce** (R8, ADR-0004; rilievo C-1 della revisione):
   - le tracce si fermano e la sorgente si scollega;
   - il watchdog si spegne, e gli heartbeat ricevono «smetti»;
   - l'avviso «cattura terminata» che Chrome manda per la scheda subito dopo (via service worker, `STREAM_ENDED`) è la conseguenza di questa chiusura e si ignora: non è un errore di cattura;
   - restano vivi soltanto il contesto, il worklet e il worker, per l'ultimo blocco e l'analisi.
   Navigazione e chiusura della scheda non scartano il risultato; «Interrompi» sì (D-Z, emendamento di ADR-0011).
6. **L'esito passa dall'evento `QUALITY` esistente.**
   - Nessun arco nuovo della macchina. I due archi da `FINALIZING` dell'emendamento di ADR-0011 sono ora accettati (D-Z).
   - Il tempo massimo è di 15 s [H]. Un errore o il tempo scaduto danno `accepted: false` → `INSUFFICIENT_DATA`, con il motivo in `analysis.failure`.
   - Un seed si mostra solo in `RESULT_READY`, cioè con almeno 8 s di voce valida (SPEC §6.1).
7. **Il risultato arriva al pannello in `CAPTURE_DIAG.analysis`** (D-Y): numeri, seed e durata dell'audio analizzato (`analysedMs`), mai audio. Il worker termina nel rilascio, prima delle tracce.
8. **Stessa regola per i file** (D-AA): il pannello mostra «cristallo possibile» e il seed solo con almeno 8 s di voce valida, come scheda e microfono.

## Conseguenze

- **Positive:**
  - una sola funzione di analisi per le tre sorgenti;
  - «blocchi concatenati = buffer intero» vale per costruzione (test unit, bit per bit);
  - D-V vale anche in cattura, senza stime in corsa;
  - il resampler con stato non serve.
- **Negative:**
  - **fino a I-07, scheda e microfono danno un seed solo dopo 45 s di ascolto**: «Interrompi» non dà mai un risultato;
  - la validità della voce è nota solo alla fine, quindi `MAX_VALID_SPEECH` non scatta mai;
  - **memoria:** circa 17 MB per 45 s stereo a 48 kHz, al massimo 48 MB al tetto di 125 s. Al momento dell'analisi la concatenazione ne fa una copia, più il mix mono e il segnale a 16 kHz: il picco è circa il doppio (rilievo L-4);
  - le impronte dei testi in `THIRD_PARTY/` sono calcolate al build sui file del repository: una modifica locale passa `pnpm build` e la ferma solo la CI, che li confronta con l'immagine Emscripten (rilievo L-5);
  - il tempo di analisi a fine sessione si aggiunge all'attesa: misurato nell'E2E del microfono (`docs/BENCHMARK_PROTOCOL.md` §7).
- **Per I-07:**
  - la regola split-half chiede descrittori ogni secondo, e ricalcolare tutto il buffer ogni secondo sarebbe troppo lento: servirà un'estrazione incrementale;
  - i frame acustici sono già calcolati per blocco di 10 ms; resta da rendere incrementale il guadagno di normalizzazione.
  - Questo ADR va allora rivisto.
- **Versioni:** nessuna nuova. `extractorVersion` e `mappingVersion` sono quelle di I-06a; `CAPTURE_DIAG` cambia forma (contratto interno, `packages/contracts/src/internal.ts`).

## Alternative scartate

- **Estrazione in corsa, a blocchi, con resampler con stato e guadagno stimato:** più lavoro, e con differenze dal percorso dei file, senza un beneficio visibile finché manca I-07.
- **Accodare a 16 kHz invece che alla frequenza sorgente:** un terzo della memoria, ma la regola del mix mono (ADR-0016) e il clipping si giudicano sulla sorgente, e il risultato non coinciderebbe più con quello dei file.
- **Mandare l'audio al documento offscreen e da lì al worker:** il PCM passerebbe dal thread principale. Il canale diretto fra worklet e worker lo evita.

## Verifica

- **`extension/test/i06b-pieces.test.ts`:**
  - accumulatore, con la proprietà «blocchi = buffer»;
  - loader con l'hash fissato;
  - guardie del protocollo;
  - file fissati della guardia del bundle.
- **`extension/test/capture-session.test.ts`:**
  - `FINALIZING` aspetta l'analisi;
  - il tempo massimo;
  - un errore;
  - lo stop che vince;
  - la registrazione solo durante l'ascolto;
  - nessun seed sotto 8 s.
- **`packages/contracts/test/internal.test.ts`:** la guardia di `CAPTURE_DIAG.analysis`.
- **E2E:**
  - microfono finto con la voce sintetica → `RESULT_READY` con seed e righe nel pannello;
  - scheda con un tono → `INSUFFICIENT_DATA` con l'analisi che dice perché;
  - file: il seed coincide con Node su 35 fixture (cancello D-N).

## Riferimenti

- **Specifica:** SPEC §5, §6.1, §7.1–§7.5, §9.
- **ADR:** ADR-0001, ADR-0004, ADR-0011, ADR-0016, ADR-0022, ADR-0023, ADR-0024.
- **Backlog e decisioni:** `docs/BACKLOG.md` I-06b (D-W, D-X, D-Y).
