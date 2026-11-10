# Stato del progetto

> Aggiornato da ogni agente a fine sessione. In cima: le cose che il prossimo lettore deve sapere subito.

**Ultimo aggiornamento:** 2026-11-10 — I-04 implementata, in attesa di CI; I-10 in corso in parallelo

> **I-04 implementata, non chiusa (2026-11-10).** Branch `issue/I-04-fixtures-harness`, nessun commit di I-04. Test locali verdi su Windows. **Non eseguito:** la CI su Linux. Mancano quindi due evidenze: il determinismo degli hash fuori da Windows e il tempo di `pnpm bench` in CI. Revisione avversariale: CONDITIONAL GO; rilievi corretti salvo le due domande al product owner (sotto). **I-10** è in lavorazione in una sessione parallela, nel suo worktree (branch `issue/I-10-crystal-core`).
>
> **I-01 chiusa il 2026-11-09.** Unita in `main` con la [PR crystal-voice#1](https://github.com/alessandronardi/crystal-voice/pull/1) in squash (commit `16cea26`); CI verde su `main` dopo il merge (run 42710710213). Residui non bloccanti: riga M0 senza versioni esatte di Chrome e SO; SPEC §5 e §14 da allineare ad ADR-0015. Nessuna issue attiva: prossime consigliate I-04 e I-10.

## Sintesi

- **Fase corrente:** 1 (PoC Chrome) e, in parallelo, 2–3 sul nucleo puro.
- **Gate:** G0 non avviato · G-PoC, G1, G2 non raggiunti.
- **Issue attive:** I-04 (questa sessione), I-10 (sessione parallela). Chiuse: **I-01**. Sbloccate: I-02, I-17; I-18 dopo I-04.
- **Codice:** monorepo pnpm, 8 pacchetti vuoti ma tipizzati, `contracts` con i tipi di SPEC §9, estensione MV3 che si costruisce e si carica in Chromium.

## I-04: Definition of Done (implementata, non chiusa)

| Voce | Stato | Evidenza |
|---|---|---|
| `pnpm fixtures` deterministico (hash dei WAV stabile) | Fatto su Windows; **Linux non verificato** | `pnpm fixtures` seguito da `pnpm fixtures --check` (fresh process): «31 fixture identiche al manifest». `tests/unit/fixtures/determinism.test.ts` ricostruisce tutto e confronta con `manifest.json` e i meta. Su Linux: **non eseguito**, la CI non è ancora partita su questo branch (nessun push) e Docker non era disponibile al revisore. Mitigazioni: quantizzazione int16 simmetrica, float dei meta arrotondati a 9 decimali, LF forzato con `.gitattributes`. |
| Ogni fixture ha un `.meta.json` con parametri e valori attesi | Fatto | 31 meta in `tests/fixtures/`: parametri, seed, valori attesi. Per la voce: f0 mediana, traccia f0 vera ogni 10 ms (`null` dove non sonora), IQR, onset, secondi sonori. Più cambio voce, livello della musica, quota di clipping, turni. Definizioni in `tests/fixtures/README.md`. |
| `pnpm bench` in CI in meno di 2 minuti [H] | **Non eseguito in CI** | Locale (Windows 11, Node 26.13.0): `pnpm bench` 0,6 s per 31 fixture, 354 s di audio, con il solo analizzatore `signal-summary-0`; `pnpm fixtures` 8,5 s. CI: passo con `timeout-minutes: 2` e report caricato come artefatto, ma mai eseguito. La misura non dice nulla del costo di YIN, VAD e descrittori (I-05/I-06). |
| Test: hash delle fixture; smoke test dell'harness | Fatto | `pnpm test`: 11 file, 193 test verdi. In più: codec WAV, PRNG con valori di riferimento confermati da un'implementazione Python indipendente, generatori (property test), `dsp-core` (`stats`, `signalSummary`), harness (report, WAV manomesso, manifest assente). |

**Verifiche eseguite il 2026-11-10** (Windows 11, Node 26.13.0, pnpm 12.18.0): `pnpm typecheck`, `pnpm lint`, `pnpm test` (193), `pnpm fixtures`, `pnpm fixtures --check`, `pnpm bench`, tutti verdi. `pnpm build` ed E2E non rieseguiti: I-04 non tocca l'estensione.

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
| D-E | Controfase: mix mono (L+R)/2; se le fasi si cancellano, ripiego sul canale più forte e warning `PHASE_CANCELLATION` | [ADR-0016](ADR/0016-mix-mono-con-rilevamento-della-cancellazione-di-fase.md), stato **Proposto**: da accettare (soglia [H] di 20 dB e dettagli). Implementazione in I-05. Il meta di `voice-a-antiphase` resta `expectedOutcome: null` finché l'ADR non è accettato |
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

1. I-04: riallineare il branch a `main` (squash di I-01 già unito), commit e push (su richiesta) per far girare la CI su Linux; poi PR.
2. **Umano:** accettare o modificare ADR-0016. Il numero 0016 va controllato contro eventuali ADR della sessione I-10 prima del merge.
3. I-10: seguire la sessione parallela (piano da approvare).
4. **Umano:** completare la riga M0 con le versioni esatte di Chrome e il SO.
5. Aggiornare SPEC §5 e §14 secondo ADR-0015 (modifica di sola documentazione).
6. Dopo I-04: I-05 (pitch e VAD) e I-18; I-02 (richiede Chrome reale) e I-17.
7. **Umano:** attivare la protezione di `main` descritta in CONTRIBUTING.md (CI obbligatoria, nessun push diretto).
8. In parallelo, azioni umane: avviare G0 (`docs/LEGAL_G0_CHECKLIST.md`) e preparare moduli di consenso e reclutamento per il dataset (I-08).

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
