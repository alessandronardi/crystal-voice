# Stato del progetto

> Aggiornato da ogni agente a fine sessione. In cima: le cose che il prossimo lettore deve sapere subito.

**Ultimo aggiornamento:** 2026-11-10 — I-05a implementata, in attesa di CI; I-04 chiusa

> **I-05a implementata, non chiusa (2026-11-10).** Branch `issue/I-05-pitch-vad`, nessun commit. Test locali verdi (225). M2 entro gli obiettivi **solo su voci sintetiche**: errore f0 mediano 0,21%, errori d'ottava 0%. **Non eseguito:** la CI. I-05 è divisa: i motori VAD reali sono in I-05b, che richiede l'approvazione delle dipendenze. Revisione avversariale: CONDITIONAL GO; rilievi corretti o con promessa ridotta. Decisioni D-G…D-K registrate più sotto; ADR-0017 estende lo stimatore a 1100 Hz per il canto.
>
> **I-04 chiusa il 2026-11-10** ([PR crystal-voice#3](https://github.com/alessandronardi/crystal-voice/pull/3), merge squash `eaddd6b`). **I-10:** la sessione parallela è ferma su una domanda senza risposta e non ha prodotto codice; va ripresa in una nuova conversazione.
>
> **I-01 chiusa il 2026-11-09** (`16cea26`). Residui non bloccanti: riga M0 senza versioni esatte di Chrome e SO; SPEC §5 e §14 da allineare ad ADR-0015.

## Sintesi

- **Fase corrente:** 1 (PoC Chrome) e, in parallelo, 2–3 sul nucleo puro.
- **Gate:** G0 non avviato · G-PoC, G1, G2 non raggiunti.
- **Issue attive:** I-05a (questa sessione). Chiuse: **I-01**, **I-04**. Sbloccate: I-02, I-10, I-17, I-18; I-05b dopo l'approvazione delle dipendenze.
- **Codice:** monorepo pnpm, 8 pacchetti vuoti ma tipizzati, `contracts` con i tipi di SPEC §9, estensione MV3 che si costruisce e si carica in Chromium.

## I-05a: Definition of Done (implementata, non chiusa)

| Voce | Stato | Evidenza |
|---|---|---|
| Errore mediano f0 ≤ 1% e d'ottava ≤ 2% sulle fixture con f0 noto | Fatto, **solo voci sintetiche** | `pnpm bench`: M2 su `voice-a`, `voice-a-long`, `voice-b` (3 voci distinte, 2861 frame sonori in verità e stima): 0,21% e 0,00%. Le varianti di guadagno e frequenza sono escluse dal pool perché sono lo stesso segnale (M3). Toni puri 100/200/400 Hz: ≤ 0,03%. Limiti: frame mancati 2,8–6,5% con f0 vera più bassa della media; mediana stimata più alta del vero di 0,22–0,82% (voice-b). Registro in `docs/BENCHMARK_PROTOCOL.md` §7 |
| Mix mono secondo ADR-0016 | Fatto | `packages/dsp-core/test/mono.test.ts`: controfase completa (ripiego e warning), quasi completa (0,9 contro −1), parziale (10 dB, nessun warning), voce duplicata in fase, input non finiti. Sul bench `voice-a-antiphase` → `channel-fallback` + `PHASE_CANCELLATION`; `voice-a-antiphase-partial` → `average`. La proprietà sull'ordine dei blocchi è rimandata al percorso a blocchi (ADR aggiornato). `PHASE_CANCELLATION_DB` = 20 resta [H] non calibrata |
| Anti-alias verificato | Fatto | Δ < 0,01 dB fino a 6,5 kHz; −6 dB a 7,2 kHz; ≤ −103 dB da 8 kHz (44,1 e 48 kHz). Test: ≥ 60 dB a 9, 12, 15 kHz |
| Interfaccia `VadEngine` pronta | Fatto, **promessa ridotta** | Sincrona, frame da 20 ms: adatta a libfvad. Silero (finestre da 512 campioni, onnxruntime asincrono) non ci entra senza adattatore: la forma definitiva si fissa in I-05b. Pre-filtro `primary: false` |
| `pnpm bench` con M2 e M12, CI < 2 min | Locale sì; **CI non eseguita** | Bench locale 5,8 s per 32 fixture e 366 s di audio; M12 0,0145 s/s in Node. Nel DSP worker di Chrome non misurato |

**Verifiche eseguite il 2026-11-10** (Windows 11, Node 26.13.0): `pnpm typecheck`, `pnpm lint`, `pnpm test` (15 file, 225 test), `pnpm fixtures --check` (32 fixture), `pnpm bench`, tutti verdi. Build ed E2E non rieseguiti: I-05a non tocca l'estensione.

**Revisione avversariale:** un passaggio, CONDITIONAL GO (1 HIGH, 6 MEDIUM, 7 LOW).
- **Corretti:**
  - M2: YIN non ripiega più un'ottava sotto le f0 fuori range: prima 600 Hz diventava 300 Hz con confidenza 0,997. Dopo la decisione D-K il range dello stimatore è 60–1100 Hz (tolleranza 0,5% sui bordi) e fuori range dà `null`.
  - M3: M2 calcolato su voci distinte.
  - M4: nel report, bias della mediana e f0 vera dei frame mancati.
  - M5: test con voce in fase; misure registrate nel protocollo; ADR aggiornato sulla proprietà dei blocchi.
  - L1: commento della finestra YIN.
  - L3: soglia di confidenza importata da `config.ts`.
  - L4: input non finiti rifiutati in `validateChannels`.
- **Promessa ridotta e documentata:** H1 (interfaccia VAD solo per motori sincroni a 20 ms); M1 (resampler solo a buffer intero, scritto nel tipo e nel modulo); L5 (pre-filtro a 2 poli); L6 (frame parziale nella mediana del mix).
- **Aperti:** nessuno. Un secondo passaggio non è stato eseguito.

**Decisioni del product owner su I-05 (10 novembre 2026)**

| ID | Decisione | Applicazione |
|---|---|---|
| D-G | Dividere I-05: I-05a pura, I-05b con i motori VAD e le loro dipendenze | `docs/BACKLOG.md`; I-06 dipende da entrambe |
| D-H | ADR-0016 accettato | Stato `Accettato`; punto 2 corretto all'accettazione: rilevamento sui frame attivi per energia, perché il VAD lavora dopo il mix |
| D-I | La confidenza di pitch `1 − d′` resta così per `extractor-0`, anche se rende inerte il filtro «≥ 0,8» | Da ricordare in I-06; nessuna modifica |
| D-J | La forma definitiva di `VadEngine` si fissa in I-05b | `docs/BACKLOG.md`, sezione I-05b |
| D-K | Il canto non deve dare `null`: stimatore YIN 60–1100 Hz; il frame intonato resta 60–500 Hz | [ADR-0017](ADR/0017-range-dello-stimatore-f0-esteso-a-1100-hz-per-il-canto.md) (Accettato). M2 invariato; falsi sonori in aumento, da filtrare in I-06 |

**Domande per il product owner:** nessuna aperta. Le tre domande della revisione sono state decise (D-I, D-J, D-K).

## I-04: Definition of Done (chiusa il 2026-11-10)

| Voce | Stato | Evidenza |
|---|---|---|
| `pnpm fixtures` deterministico (hash dei WAV stabile) | Fatto | Windows 11: `pnpm fixtures` seguito da `pnpm fixtures --check` (fresh process): «31 fixture identiche al manifest». Linux: passo `fixtures` (`--check` sul manifest generato su Windows, poi generazione) verde sulla [run 42781706222](https://github.com/alessandronardi/crystal-voice/actions/runs/42781706222), 8 s, Node da `.nvmrc`. `tests/unit/fixtures/determinism.test.ts` ricostruisce tutto e confronta con `manifest.json` e i meta. Esito letto dall'API pubblica di GitHub (stato e durata dei passi); log non letti. Mitigazioni: quantizzazione int16 simmetrica, float dei meta arrotondati a 9 decimali, LF forzato con `.gitattributes`. |
| Ogni fixture ha un `.meta.json` con parametri e valori attesi | Fatto | 31 meta in `tests/fixtures/`: parametri, seed, valori attesi. Per la voce: f0 mediana, traccia f0 vera ogni 10 ms (`null` dove non sonora), IQR, onset, secondi sonori. Più cambio voce, livello della musica, quota di clipping, turni. Definizioni in `tests/fixtures/README.md`. |
| `pnpm bench` in CI in meno di 2 minuti [H] | Fatto, con riserva | CI: passo `bench` verde in 1 s sulla [run 42781706222](https://github.com/alessandronardi/crystal-voice/actions/runs/42781706222) (timeout 2 min, report `latest.json` caricato come artefatto). Locale: 0,6 s per 31 fixture, 354 s di audio. **Riserva:** misura con il solo analizzatore `signal-summary-0`. La misura non dice nulla del costo di YIN, VAD e descrittori (I-05/I-06). |
| Test: hash delle fixture; smoke test dell'harness | Fatto | `pnpm test`: 11 file, 193 test verdi. In più: codec WAV, PRNG con valori di riferimento confermati da un'implementazione Python indipendente, generatori (property test), `dsp-core` (`stats`, `signalSummary`), harness (report, WAV manomesso, manifest assente). |

**Verifiche eseguite il 2026-11-10** (Windows 11, Node 26.13.0, pnpm 12.18.0): `pnpm typecheck`, `pnpm lint`, `pnpm test` (193), `pnpm fixtures`, `pnpm fixtures --check`, `pnpm bench`, tutti verdi. `pnpm build` ed E2E non rieseguiti: I-04 non tocca l'estensione.

**Prima CI del branch (commit `611cfdb`): rossa.** Su `ubuntu-latest` il property test dei quantili ha trovato il controesempio `[-0, 0]` (seed fast-check 2069321282). Con quell'input P0 restituiva `+0` invece di `-0`, perché l'interpolazione `a + 0·(b − a)` cambia il segno dello zero. Correzione: quando non c'è nulla da interpolare si restituisce l'ordinale esatto. Aggiunto un test di regressione; il property test con quel seed passa per 1000 esecuzioni in locale. I passi «fixtures» e «bench» non erano stati raggiunti.

**CI:** la prima run (`611cfdb`) era rossa, vedi sotto; la seconda (`353c4cd`, [run 42781706222](https://github.com/alessandronardi/crystal-voice/actions/runs/42781706222)) è verde in tutti i job, E2E compreso.

**Revisione avversariale:** un passaggio, CONDITIONAL GO, 2 HIGH, 6 MEDIUM, 6 LOW.
- **Corretti:**
  - H1: traccia f0 vera per frame.
  - H2: `voice-a-long` con 22 s di nuclei, controllo positivo per I-07.
  - M1: float dei meta arrotondati.
  - M2: timeout di 2 min e artefatto.
  - M3: esito della controfase lasciato `null`.
  - M4: coppie A/B con rapporto di f0 1,75, 1,25 e 1,1; accordi di lunghezza diversa.
  - M5: ritmo della voce portato a 4,6–5,6 onset/s, dentro gli ancoraggi di `mapping-0` (2–7).
  - L1: sweep descritto in forma leggibile da macchina; aggiunto il gradino di frequenza.
  - L2: meta orfani rilevati.
  - L3: campo `chrome: null` nel report; campi numerici del manifest validati come interi.
  - L6: eccezione al posto del ripiego a 0.
- **Annotati come limiti nel README:** granularità delle quote (5/5, 3/3); onset spuri nei tagli dell'alternanza; nessun test che confronti la verità con la forma d'onda (L4).
- **Aperti:** nessuno; le due domande sono state decise (D-E, D-F). Un secondo passaggio non è stato eseguito.

**Decisioni del product owner su I-04 (10 novembre 2026)**

| ID | Decisione | Applicazione |
|---|---|---|
| D-E | Controfase: mix mono (L+R)/2; se le fasi si cancellano, ripiego sul canale più forte e warning `PHASE_CANCELLATION` | [ADR-0016](ADR/0016-mix-mono-con-rilevamento-della-cancellazione-di-fase.md), accettato il 2026-11-10 (D-H) e implementato in I-05a; il meta di `voice-a-antiphase` dichiara l'esito |
| D-F | Le fixture e i test dei timeout di arresto vanno in I-07, con sequenze sintetiche di descrittori | Voce aggiunta alla DoD di I-07 in `docs/BACKLOG.md` |

**Fuori perimetro, annotati:** ESLint ignora `.claude/worktrees/**`, perché senza il lint falliva sui file del worktree della sessione I-10. `.gitattributes` è nuovo. Le cartelle non tracciate `.agents/` e `.codex/` sono state create da Codex: da cancellare (la cancellazione da parte dell'agente è stata bloccata dai permessi).

## I-01: Definition of Done (chiusa)

| Voce | Stato | Evidenza |
|---|---|---|
| `pnpm build` produce `dist/extension/` caricabile in Chrome 120 e nella stabile, senza errori nel pannello estensioni | Fatto (M0 dichiarato dal product owner) | M0 superato in Chrome 120 e stabile secondo il product owner (2026-11-09, commit `affa212`, registro in `tests/e2e/MANUAL_CHECKLIST.md`): l'agente non l'ha osservato, versioni esatte e SO da completare. Inoltre: Caricata senza errori in console nel Chromium 156.0.8078.4 di Playwright 1.64.0, su Windows 11, con e senza finestra (2/2 E2E). **Non eseguito** su Chrome 120 e su Chrome stabile: nessuna delle due build è presente in questo ambiente. Va fatto a mano con la voce M0 di `tests/e2e/MANUAL_CHECKLIST.md`. Gli errori del pannello `chrome://extensions` non sono leggibili da Playwright. |
| Regola ESLint di purezza: nei pacchetti puri vietati `chrome`, `window`, `document`, `three`; in `crystal-core/src/geometry/` vietati `Math.random`, `Date`, `Math.sin/cos/tan/atan2/exp/pow/log` | Fatto | `tooling/eslint/purity.js`. Copre in più: rete, globali Node e import di moduli Node (lista da `builtinModules`), `import()` dinamico, R11 su tutto `crystal-core` (casualità, orologi, `let`/`var` di modulo, alias di `Math` e `crypto`), e in `geometry/` solo membri `Math` ammessi e nessun import con `..`. **Limite dichiarato:** lo stato mutabile dentro `const` (oggetti, `Map`, campi statici) non viene rilevato. |
| Un test dimostra che la regola scatta (`tests/lint-fixtures/`) | Fatto | `tests/lint/purity.test.ts`, 29 test. Ogni riga marcata `// ✗` nei fixture deve essere segnalata e nessun'altra riga può esserlo. |
| CSP senza sorgenti remote; build fallisce con `eval` o `new Function` | Fatto | CSP con `connect-src 'self'` (ADR-0015): l'E2E verifica che `fetch` verso l'esterno sia rifiutato da Side Panel e service worker. Inoltre: `extension/scripts/bundle-guard.ts` lavora sul bundle **minificato**: un test minifica davvero con Vite e verifica che `Function(e)` e `globalThis.eval` vengano rilevati. Rileva anche gli URL assoluti (in template e concatenazioni) e valida il manifest con un elenco di chiavi, permessi e match ammessi. **Limite:** è un controllo testuale, ora seconda linea di difesa dietro la CSP; il content script non è coperto dalla CSP delle pagine (ipotesi da verificare in I-03). |
| `tests/e2e/README.md` documenta il caricamento in Playwright e se l'headless è supportato | Fatto | Headless **verificato** su Windows con il canale `chromium` di Playwright 1.64.0. Non verificato su Linux. |
| Test: CI verde | Fatto | [Run 42707392231](https://github.com/alessandronardi/crystal-voice/actions/runs/42707392231) del 2026-11-09 sul commit `34f972c`, con Node 26.13.0 da `.nvmrc` su `ubuntu-latest`: `typecheck, lint, test, build` superato; `e2e (Chromium, extension loaded)` superato (sotto `xvfb-run`). Esito letto dall'API pubblica di GitHub (stato dei job); i log dettagliati non sono stati letti dall'agente. |
| Test: E2E «l'estensione si carica e il service worker risponde a un ping» | Fatto | `tests/e2e/extension-loads.spec.ts`: 3/3 con e senza finestra. |

**Verifiche eseguite il 2026-11-09** (Windows 11, Node 24.4.1, pnpm 12.18.0): `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (4 file, 147 test), `pnpm build` (14 file, guardia superata), `pnpm test:e2e` con e senza finestra (3/3). **Ripetute il 2026-11-09 su Node 26.13.0** (installato dal product owner, versione verificata dall'agente con `node -v`): install, typecheck, lint, 147 test, build ed E2E 3/3 con finestra, tutti verdi (output del terminale del product owner).

**Revisione avversariale:** due passaggi indipendenti.
- **Primo passaggio:** NO-GO, con 1 rilievo CRITICAL, 3 HIGH e 5 MEDIUM.
- **Secondo passaggio:** CONDITIONAL GO. I rilievi che restavano aperti (import aggirabili in `geometry/`, `(0,eval)`, URL composti, rete nei pacchetti puri, alias di `Math` e `crypto`) sono stati corretti dopo il secondo passaggio e coperti da test. Un terzo passaggio non è stato eseguito.

## Decisioni del product owner su I-01 (9 novembre 2026)

| ID | Decisione | Applicazione |
|---|---|---|
| D-A | CSP con `connect-src 'self'` | ADR-0015 (Accettato); manifest, guardia ed E2E aggiornati. **Da fare:** aggiornare SPEC §5 e §14 come elencato nell'ADR |
| D-B | Le licenze fuori elenco sono ammesse per dipendenze di sviluppo che non entrano nel bundle | Nota in AGENTS.md §8. Oggi: `lightningcss` (MPL-2.0), `minimatch` (BlueOak-1.0.0) |
| D-C | `PING`/`PONG` resta nel bundle | Rivalutare l'esclusione dalle build di rilascio in I-16 |
| D-D | Node LTS attiva: 26 «Lithium» (LTS dal 2026-10-28, fonte `nodejs/Release` schedule.json; la 24 è in manutenzione dal 2026-10-20) | `.nvmrc` 26.13.0, `engines` ≥ 26, `@types/node` 26.6.6. Ambiente locale aggiornato a 26.13.0 e verificato |

## Prossimi passi

1. I-05a: commit e push (su richiesta) per la CI; poi PR e merge.
2. I-05b: decidere le dipendenze VAD (libfvad compilato con Emscripten; Silero con onnxruntime-web, circa 10–12 MB di WASM).
3. I-10: ripartire in una nuova conversazione. Usare un numero di ADR dopo il 0017 e un branch `issue/I-10-crystal-core`.
4. **Umano:** completare la riga M0 con le versioni esatte di Chrome e il SO; cancellare `.agents/` e `.codex/`.
5. Aggiornare SPEC §5 e §14 secondo ADR-0015 (modifica di sola documentazione).
6. **Umano:** attivare la protezione di `main` descritta in CONTRIBUTING.md (CI obbligatoria, nessun push diretto).
7. In parallelo, azioni umane: avviare G0 (`docs/LEGAL_G0_CHECKLIST.md`) e preparare moduli di consenso e reclutamento per il dataset (I-08).

## Blocchi

- Fase 4 e 5 bloccate fino a G0.

## Dipendenze nuove (I-01)

Tutte di sviluppo: nessuna entra nel bundle, salvo il CSS generato da Tailwind. Versioni esatte nel lockfile. pnpm 12 applica la quarantena di pubblicazione: nessuna esclusione configurata.

| Pacchetto | Versione | Licenza | Motivo |
|---|---|---|---|
| typescript | 6.0.3 | Apache-2.0 | Stack [F]. La 7.x non è compatibile con typescript-eslint (`<6.1`) |
| vite | 8.3.5 | MIT | Build multi-entry MV3 [F] |
| tailwindcss, @tailwindcss/vite | 4.3.3 | MIT | CSS compilato localmente [F] |
| vitest | 5.1.0 | MIT | Test unit [F] |
| fast-check | 4.10.2 | MIT | Property test |
| @playwright/test | 1.64.0 | Apache-2.0 | E2E [F]; usa il Chromium 1248 già in cache |
| eslint, @eslint/js | 10.14.0, 10.0.1 | MIT | Lint e regole di purezza |
| typescript-eslint | 8.72.1 | MIT | Lint con tipi. La 8.72.2 era stata pubblicata da meno di 24 ore |
| @types/chrome, @types/node | 0.3.7, 26.6.6 | MIT | Tipi |

## Verificato / non verificato

| Voce | Stato |
|---|---|
| Comportamento API Chrome (`sidePanel`, `tabCapture`, `offscreen`) | Verificato su documentazione il 9 nov 2026; **non** ancora in Chrome reale |
| Caricamento dell'estensione | Verificato dall'agente in Chromium 156 (Playwright); in Chrome 120 e stabile dichiarato superato dal product owner (M0) |
| CSP `connect-src 'self'` a runtime | Verificato in Chromium 156 (E2E) per Side Panel e service worker; content script non coperto (da verificare in I-03) |
| Headless con estensione | Verificato su Windows (canale `chromium`); non su Linux |
| `--load-extension` ignorato da Google Chrome «branded» recente | Segnalato; `needs current-doc verification` |
| Conflitto `openPanelOnActionClick` / `onClicked` | Segnalato dalla community; da verificare in I-02 |
| Microfono in offscreen dopo permesso in pagina estensione | Da verificare in I-17 |
| Automazione del gesto per `tabCapture` in Playwright | Da verificare in I-02 |
| Corrispondenza fra SHA delle GitHub Actions e tag `v4` | Ottenuti con `git ls-remote` il 9 nov 2026; la run 42707392231 li ha usati con successo |
| `pnpm/action-setup` con pnpm 12.18.0, Node 26 su `ubuntu-latest` | Verificato dalla run 42707392231 |
| Simulazioni della revisione (affinità, cambio lati) | Eseguite su dati sintetici; da confermare su dati reali in G1 |

## Proposte fuori perimetro

- Resampler con stato per il percorso a blocchi del worker, con test «blocchi concatenati = buffer intero» (rilievo M1 di I-05a). Serve a I-03/I-06.

- Fixture: un test di regressione che confronti la verità di f0 con uno stimatore indipendente sulla forma d'onda (rilievo L4). Va con I-05, quando YIN esiste.

- `VC_SOURCE_TAB` (esito G0 (b)): non introdotto in I-01, perché senza G0 sarebbe codice morto. Va con I-16 o con l'esito G0.
- Guardia del bundle: quando arriverà Three.js (I-11) sono probabili falsi positivi (`Function`, `eval`, URL nei commenti delle shader). Si gestiscono con `GUARD_EXCEPTIONS`, una voce motivata per ciascuno.

## Registro sessioni

| Data | Agente | Issue | Esito | Note |
|---|---|---|---|---|
| 2026-11-09 | Claude | — | Documentazione di progetto | Spec v0.3, ADR 0001–0014, backlog, gate |
| 2026-11-09 | Claude | I-01 | Implementata, non chiusa | Test locali verdi; due revisioni avversariali (NO-GO → CONDITIONAL GO, rilievi residui corretti); M0, CI e D-A…D-D aperti; nessun commit |
| 2026-11-09 | Claude | I-01 | Decisioni applicate | D-A…D-D applicate (ADR-0015, AGENTS §8, Node 26); M0 registrato su dichiarazione del product owner; remote `origin` e push; CI verde (run 42707392231) |
| 2026-11-09 | Claude | I-01 | Node 26 in locale | Suite completa verde su Node 26.13.0 in locale |
| 2026-11-09 | Claude | I-01 | Chiusa | PR crystal-voice#1 unita in squash (`16cea26`), CI verde su `main` |
| 2026-11-10 | Claude | I-04 | Implementata, non chiusa | 31 fixture deterministiche, `pnpm bench`, 193 test verdi; revisione avversariale CONDITIONAL GO, rilievi corretti; CI su Linux non eseguita; nessun commit. I-10 avviata in sessione parallela |
| 2026-11-10 | Claude | I-04 | DoD completa | Commit `611cfdb` e `353c4cd` (fix dei quantili su −0 trovato dalla CI); CI verde ([run 42781706222](https://github.com/alessandronardi/crystal-voice/actions/runs/42781706222)): hash stabili su Linux, bench 1 s; ADR-0016 Proposto; in attesa di PR |
| 2026-11-10 | Claude | I-04 | Chiusa | PR crystal-voice#3 unita in squash (`eaddd6b`) |
| 2026-11-10 | Claude | I-05a | Implementata, non chiusa | I-05 divisa (D-G); ADR-0016 accettato (D-H); mix mono, resampler, YIN, interfaccia VAD; M2 0,21% / 0% su voci sintetiche; revisione CONDITIONAL GO, rilievi corretti; CI non eseguita; nessun commit |
