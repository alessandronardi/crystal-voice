# Stato del progetto

> Aggiornato da ogni agente a fine sessione. In cima: le cose che il prossimo lettore deve sapere subito.

**Ultimo aggiornamento:** 2026-11-09 — I-01 completata sul branch, CI verde; manca il merge

> **I-01: tutte le voci della DoD hanno un'evidenza; manca solo il merge.** CI verde sulla [run 42707392231](https://github.com/alessandronardi/crystal-voice/actions/runs/42707392231) (commit `34f972c`). Il passo successivo è la PR da `issue/I-01-skeleton-ci` verso `main`, con revisione umana e merge in squash. M0 è registrato su dichiarazione del product owner.

## Sintesi

- **Fase corrente:** 1 (PoC Chrome) e, in parallelo, 2–3 sul nucleo puro.
- **Gate:** G0 non avviato · G-PoC, G1, G2 non raggiunti.
- **Issue attiva:** I-01 · Scheletro monorepo, build MV3, lint di purezza, CI.
- **Codice:** monorepo pnpm, 8 pacchetti vuoti ma tipizzati, `contracts` con i tipi di SPEC §9, estensione MV3 che si costruisce e si carica in Chromium.

## I-01: stato della Definition of Done

| Voce | Stato | Evidenza |
|---|---|---|
| `pnpm build` produce `dist/extension/` caricabile in Chrome 120 e nella stabile, senza errori nel pannello estensioni | Fatto (M0 dichiarato dal product owner) | M0 superato in Chrome 120 e stabile secondo il product owner (2026-11-09, commit `affa212`, registro in `tests/e2e/MANUAL_CHECKLIST.md`): l'agente non l'ha osservato, versioni esatte e SO da completare. Inoltre: Caricata senza errori in console nel Chromium 156.0.8078.4 di Playwright 1.64.0, su Windows 11, con e senza finestra (2/2 E2E). **Non eseguito** su Chrome 120 e su Chrome stabile: nessuna delle due build è presente in questo ambiente. Va fatto a mano con la voce M0 di `tests/e2e/MANUAL_CHECKLIST.md`. Gli errori del pannello `chrome://extensions` non sono leggibili da Playwright. |
| Regola ESLint di purezza: nei pacchetti puri vietati `chrome`, `window`, `document`, `three`; in `crystal-core/src/geometry/` vietati `Math.random`, `Date`, `Math.sin/cos/tan/atan2/exp/pow/log` | Fatto | `tooling/eslint/purity.js`. Copre in più: rete, globali Node e import di moduli Node (lista da `builtinModules`), `import()` dinamico, R11 su tutto `crystal-core` (casualità, orologi, `let`/`var` di modulo, alias di `Math` e `crypto`), e in `geometry/` solo membri `Math` ammessi e nessun import con `..`. **Limite dichiarato:** lo stato mutabile dentro `const` (oggetti, `Map`, campi statici) non viene rilevato. |
| Un test dimostra che la regola scatta (`tests/lint-fixtures/`) | Fatto | `tests/lint/purity.test.ts`, 29 test. Ogni riga marcata `// ✗` nei fixture deve essere segnalata e nessun'altra riga può esserlo. |
| CSP senza sorgenti remote; build fallisce con `eval` o `new Function` | Fatto | CSP con `connect-src 'self'` (ADR-0015): l'E2E verifica che `fetch` verso l'esterno sia rifiutato da Side Panel e service worker. Inoltre: `extension/scripts/bundle-guard.ts` lavora sul bundle **minificato**: un test minifica davvero con Vite e verifica che `Function(e)` e `globalThis.eval` vengano rilevati. Rileva anche gli URL assoluti (in template e concatenazioni) e valida il manifest con un elenco di chiavi, permessi e match ammessi. **Limite:** è un controllo testuale, ora seconda linea di difesa dietro la CSP; il content script non è coperto dalla CSP delle pagine (ipotesi da verificare in I-03). |
| `tests/e2e/README.md` documenta il caricamento in Playwright e se l'headless è supportato | Fatto | Headless **verificato** su Windows con il canale `chromium` di Playwright 1.64.0. Non verificato su Linux. |
| Test: CI verde | Fatto | [Run 42707392231](https://github.com/alessandronardi/crystal-voice/actions/runs/42707392231) del 2026-11-09 sul commit `34f972c`, con Node 26.13.0 da `.nvmrc` su `ubuntu-latest`: `typecheck, lint, test, build` superato; `e2e (Chromium, extension loaded)` superato (sotto `xvfb-run`). Esito letto dall'API pubblica di GitHub (stato dei job); i log dettagliati non sono stati letti dall'agente. |
| Test: E2E «l'estensione si carica e il service worker risponde a un ping» | Fatto | `tests/e2e/extension-loads.spec.ts`: 3/3 con e senza finestra. |

**Verifiche eseguite il 2026-11-09** (Windows 11, Node 24.4.1, pnpm 12.18.0): `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (4 file, 147 test), `pnpm build` (14 file, guardia superata), `pnpm test:e2e` con e senza finestra (3/3). **In locale non c'è Node 26:** la prima esecuzione su Node 26.13.0 è quella della CI.

**Revisione avversariale:** due passaggi indipendenti.
- **Primo passaggio:** NO-GO, con 1 rilievo CRITICAL, 3 HIGH e 5 MEDIUM.
- **Secondo passaggio:** CONDITIONAL GO. I rilievi che restavano aperti (import aggirabili in `geometry/`, `(0,eval)`, URL composti, rete nei pacchetti puri, alias di `Math` e `crypto`) sono stati corretti dopo il secondo passaggio e coperti da test. Un terzo passaggio non è stato eseguito.

## Decisioni del product owner su I-01 (9 novembre 2026)

| ID | Decisione | Applicazione |
|---|---|---|
| D-A | CSP con `connect-src 'self'` | ADR-0015 (Accettato); manifest, guardia ed E2E aggiornati. **Da fare:** aggiornare SPEC §5 e §14 come elencato nell'ADR |
| D-B | Le licenze fuori elenco sono ammesse per dipendenze di sviluppo che non entrano nel bundle | Nota in AGENTS.md §8. Oggi: `lightningcss` (MPL-2.0), `minimatch` (BlueOak-1.0.0) |
| D-C | `PING`/`PONG` resta nel bundle | Rivalutare l'esclusione dalle build di rilascio in I-16 |
| D-D | Node LTS attiva: 26 «Lithium» (LTS dal 2026-10-28, fonte `nodejs/Release` schedule.json; la 24 è in manutenzione dal 2026-10-20) | `.nvmrc` 26.13.0, `engines` ≥ 26, `@types/node` 26.6.6. **L'ambiente locale ha ancora Node 24.4.1**: installare Node 26 |

## Prossimi passi

1. **Umano:** aprire la PR da `issue/I-01-skeleton-ci` (https://github.com/alessandronardi/crystal-voice/pull/new/issue/I-01-skeleton-ci), rivederla e fare il merge in squash. L'agente non può aprirla: `gh` non è installato. Poi I-01 è chiusa.
2. **Umano:** installare Node 26.13.0 in locale; completare la riga M0 con le versioni esatte di Chrome e il SO.
3. Aggiornare SPEC §5 e §14 secondo ADR-0015 (modifica di sola documentazione).
4. Dopo I-01: I-04 e I-10 (pure, verificabili per intero in Node), I-02 (richiede Chrome reale), I-17.
5. In parallelo, azioni umane: avviare G0 (`docs/LEGAL_G0_CHECKLIST.md`) e preparare moduli di consenso e reclutamento per il dataset (I-08).

## Blocchi

- Fase 4 e 5 bloccate fino a G0.
- Chiusura di I-01: PR e merge (azione umana).

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

- `VC_SOURCE_TAB` (esito G0 (b)): non introdotto in I-01, perché senza G0 sarebbe codice morto. Va con I-16 o con l'esito G0.
- Guardia del bundle: quando arriverà Three.js (I-11) sono probabili falsi positivi (`Function`, `eval`, URL nei commenti delle shader). Si gestiscono con `GUARD_EXCEPTIONS`, una voce motivata per ciascuno.

## Registro sessioni

| Data | Agente | Issue | Esito | Note |
|---|---|---|---|---|
| 2026-11-09 | Claude | — | Documentazione di progetto | Spec v0.3, ADR 0001–0014, backlog, gate |
| 2026-11-09 | Claude | I-01 | Implementata, non chiusa | Test locali verdi; due revisioni avversariali (NO-GO → CONDITIONAL GO, rilievi residui corretti); M0, CI e D-A…D-D aperti; nessun commit |
| 2026-11-09 | Claude | I-01 | Decisioni applicate | D-A…D-D applicate (ADR-0015, AGENTS §8, Node 26); M0 registrato su dichiarazione del product owner; remote `origin` e push; CI verde (run 42707392231) |
