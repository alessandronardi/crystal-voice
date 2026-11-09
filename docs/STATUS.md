# Stato del progetto

> Aggiornato da ogni agente a fine sessione. In cima: le cose che il prossimo lettore deve sapere subito.

**Ultimo aggiornamento:** 2026-11-09 — I-01 implementata, non chiusa

> **I-01 non è chiusa.** Codice e test locali sono verdi. Mancano due voci della DoD che richiedono un umano: il caricamento in Chrome 120 e in Chrome stabile (checklist M0) e una CI verde (nessun remote). Sono aperte anche quattro decisioni del product owner, elencate sotto. Il lavoro è sul branch `issue/I-01-skeleton-ci`, **non committato**.

## Sintesi

- **Fase corrente:** 1 (PoC Chrome) e, in parallelo, 2–3 sul nucleo puro.
- **Gate:** G0 non avviato · G-PoC, G1, G2 non raggiunti.
- **Issue attiva:** I-01 · Scheletro monorepo, build MV3, lint di purezza, CI.
- **Codice:** monorepo pnpm, 8 pacchetti vuoti ma tipizzati, `contracts` con i tipi di SPEC §9, estensione MV3 che si costruisce e si carica in Chromium.

## I-01: stato della Definition of Done

| Voce | Stato | Evidenza |
|---|---|---|
| `pnpm build` produce `dist/extension/` caricabile in Chrome 120 e nella stabile, senza errori nel pannello estensioni | **Parziale** | Caricata senza errori in console nel Chromium 156.0.8078.4 di Playwright 1.64.0, su Windows 11, con e senza finestra (2/2 E2E). **Non eseguito** su Chrome 120 e su Chrome stabile: nessuna delle due build è presente in questo ambiente. Va fatto a mano con la voce M0 di `tests/e2e/MANUAL_CHECKLIST.md`. Gli errori del pannello `chrome://extensions` non sono leggibili da Playwright. |
| Regola ESLint di purezza: nei pacchetti puri vietati `chrome`, `window`, `document`, `three`; in `crystal-core/src/geometry/` vietati `Math.random`, `Date`, `Math.sin/cos/tan/atan2/exp/pow/log` | Fatto | `tooling/eslint/purity.js`. Copre in più: rete, globali Node e import di moduli Node (lista da `builtinModules`), `import()` dinamico, R11 su tutto `crystal-core` (casualità, orologi, `let`/`var` di modulo, alias di `Math` e `crypto`), e in `geometry/` solo membri `Math` ammessi e nessun import con `..`. **Limite dichiarato:** lo stato mutabile dentro `const` (oggetti, `Map`, campi statici) non viene rilevato. |
| Un test dimostra che la regola scatta (`tests/lint-fixtures/`) | Fatto | `tests/lint/purity.test.ts`, 29 test. Ogni riga marcata `// ✗` nei fixture deve essere segnalata e nessun'altra riga può esserlo. |
| CSP senza sorgenti remote; build fallisce con `eval` o `new Function` | Fatto, con limiti | `extension/scripts/bundle-guard.ts` lavora sul bundle **minificato**: un test minifica davvero con Vite e verifica che `Function(e)` e `globalThis.eval` vengano rilevati. Rileva anche gli URL assoluti (in template e concatenazioni) e valida il manifest con un elenco di chiavi, permessi e match ammessi. **Limite:** è un controllo testuale. Un URL costruito senza nessun frammento letterale di schema non viene rilevato, e la CSP di SPEC §5 non limita la rete (decisione D-A). |
| `tests/e2e/README.md` documenta il caricamento in Playwright e se l'headless è supportato | Fatto | Headless **verificato** su Windows con il canale `chromium` di Playwright 1.64.0. Non verificato su Linux. |
| Test: CI verde | **Non eseguito** | `.github/workflows/ci.yml` è scritto ma non è mai stato eseguito: il repository non ha remote e `gh` non è installato. Da verificare anche che `pnpm/action-setup` supporti pnpm 12.18.0. |
| Test: E2E «l'estensione si carica e il service worker risponde a un ping» | Fatto | `tests/e2e/extension-loads.spec.ts`: 2/2 con e senza finestra. |

**Verifiche eseguite il 2026-11-09** (Windows 11, Node 24.4.1, pnpm 12.18.0): `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` (4 file, 144 test), `pnpm build` (14 file, 8,7 KB, guardia superata), `pnpm test:e2e` con e senza finestra (2/2).

**Revisione avversariale:** due passaggi indipendenti.
- **Primo passaggio:** NO-GO, con 1 rilievo CRITICAL, 3 HIGH e 5 MEDIUM.
- **Secondo passaggio:** CONDITIONAL GO. I rilievi che restavano aperti (import aggirabili in `geometry/`, `(0,eval)`, URL composti, rete nei pacchetti puri, alias di `Math` e `crypto`) sono stati corretti dopo il secondo passaggio e coperti da test. Un terzo passaggio non è stato eseguito.

## Decisioni richieste al product owner

| ID | Domanda | Contesto |
|---|---|---|
| D-A | Aggiungere `connect-src 'self'` (o `default-src 'self'`) alla CSP con un ADR? | La CSP di SPEC §5 [F] blocca `eval` ma non la rete. Senza, R2 a runtime è difeso solo dalla guardia testuale e dal lint. Lo raccomandano entrambe le revisioni. |
| D-B | L'elenco delle licenze ammesse (AGENTS §8) vale anche per le dipendenze di sviluppo transitive che non entrano nel bundle? | `lightningcss` 1.32/1.33 (MPL-2.0, da Vite e Tailwind, entrambi [F] in SPEC §4) e `minimatch` 10.2.6 (BlueOak-1.0.0, da ESLint). Nessuna delle due finisce in `dist/`. |
| D-C | Il messaggio diagnostico `PING`/`PONG` resta nel bundle di rilascio? | Non fa parte di `CaptureMessage`, non porta `sessionId`/`seq` né dati. Serve all'E2E. In alternativa: escluderlo dalle build di rilascio (I-16). |
| D-D | Quale versione di Node fissare? | `.nvmrc` = 24.4.1, la versione installata qui. AGENTS §6 chiede la «LTS attiva»: a novembre 2026 potrebbe essere la 26.x (`needs current-doc verification`). |

## Prossimi passi

1. **Umano:** eseguire M0 in Chrome 120 e in Chrome stabile e registrarlo in `tests/e2e/MANUAL_CHECKLIST.md`.
2. **Umano:** creare il remote, poi commit, push e prima esecuzione della CI. I commit li fa l'agente solo su richiesta.
3. Rispondere a D-A…D-D. Dopo, se servono, un ADR e gli aggiustamenti, poi la chiusura di I-01.
4. Dopo I-01: I-02 e I-04 in parallelo; I-10 e I-17 possono partire.
5. In parallelo, azioni umane: avviare G0 (`docs/LEGAL_G0_CHECKLIST.md`) e preparare moduli di consenso e reclutamento per il dataset (I-08).

## Blocchi

- Fase 4 e 5 bloccate fino a G0.
- Chiusura di I-01: M0 e CI (azioni umane).

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
| @types/chrome, @types/node | 0.3.7, 24.19.2 | MIT | Tipi |

## Verificato / non verificato

| Voce | Stato |
|---|---|
| Comportamento API Chrome (`sidePanel`, `tabCapture`, `offscreen`) | Verificato su documentazione il 9 nov 2026; **non** ancora in Chrome reale |
| Caricamento dell'estensione | Verificato in Chromium 156 (Playwright); **non** in Chrome 120 né in Chrome stabile |
| Headless con estensione | Verificato su Windows (canale `chromium`); non su Linux |
| `--load-extension` ignorato da Google Chrome «branded» recente | Segnalato; `needs current-doc verification` |
| Conflitto `openPanelOnActionClick` / `onClicked` | Segnalato dalla community; da verificare in I-02 |
| Microfono in offscreen dopo permesso in pagina estensione | Da verificare in I-17 |
| Automazione del gesto per `tabCapture` in Playwright | Da verificare in I-02 |
| Corrispondenza fra SHA delle GitHub Actions e tag `v4` | Ottenuti con `git ls-remote` il 9 nov 2026; non verificati in una run |
| Simulazioni della revisione (affinità, cambio lati) | Eseguite su dati sintetici; da confermare su dati reali in G1 |

## Proposte fuori perimetro

- `VC_SOURCE_TAB` (esito G0 (b)): non introdotto in I-01, perché senza G0 sarebbe codice morto. Va con I-16 o con l'esito G0.
- Guardia del bundle: quando arriverà Three.js (I-11) sono probabili falsi positivi (`Function`, `eval`, URL nei commenti delle shader). Si gestiscono con `GUARD_EXCEPTIONS`, una voce motivata per ciascuno.

## Registro sessioni

| Data | Agente | Issue | Esito | Note |
|---|---|---|---|---|
| 2026-11-09 | Claude | — | Documentazione di progetto | Spec v0.3, ADR 0001–0014, backlog, gate |
| 2026-11-09 | Claude | I-01 | Implementata, non chiusa | Test locali verdi; due revisioni avversariali (NO-GO → CONDITIONAL GO, rilievi residui corretti); M0, CI e D-A…D-D aperti; nessun commit |
