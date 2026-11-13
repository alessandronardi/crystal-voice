# AGENTS.md — Regole per ogni agente che lavora su VoiceCrystal

Questo file vale per qualunque agente di programmazione (Claude Code, Codex, Cursor, altri) e per gli sviluppatori umani. `CLAUDE.md` lo importa e aggiunge solo istruzioni specifiche di Claude Code.

## 1. Il progetto in tre righe

VoiceCrystal è un'estensione Chrome MV3 che trasforma un segmento di parlato in un cristallo 3D generato deterministicamente da sei descrittori acustici. Le sorgenti sono due: l'audio di una scheda YouTube `/watch` e «La tua voce» (microfono o file locale). Tutto avviene in locale: nessun backend, nessuna telemetria, nessun audio salvato.

## 2. Fonti di verità, in ordine di precedenza

1. `docs/SPEC_v0.3.md` — specifica normativa. I marcatori `[F]` sono vincolanti, `[H]` sono ipotesi da calibrare, `[G]` sono gate, `[P]` è fuori MVP.
2. `docs/ADR/` — decisioni architetturali accettate. Un ADR più recente prevale sulla specifica solo se lo dichiara esplicitamente.
3. `docs/BACKLOG.md` — issue, dipendenze, Definition of Done.
4. `docs/GATES.md` — criteri per passare di fase.
5. Il codice esistente.

**Se due fonti sono in conflitto o un requisito è impossibile: fermati.** Non scegliere un'interpretazione in silenzio. Scrivi una proposta in `docs/ADR/` con stato `Proposto`, descrivi il conflitto nella PR o nel messaggio finale e attendi la decisione di un umano.

## 3. Stato attuale del progetto

Lo stato vivo (fase, issue in corso, ultimo gate, blocchi) è in `docs/STATUS.md`. Leggilo all'inizio di ogni sessione e aggiornalo alla fine.

- Fasi autorizzate: **1, 2, 3** (PoC, DSP offline, crystal core e renderer).
- Fase 4 e 5: **sviluppabili**; **distribuzione bloccata fino alla chiusura di G0** (valutazione legale, ADR-0027). Prima di G0 nessuna pubblicazione (Chrome Web Store o altro), nessun pacchetto distribuibile, nessuna build consegnata a terzi; la CI non carica la build dell'estensione come artefatto. Ogni PR di fase 4 o 5 dichiara «non distribuibile prima di G0».

## 4. Regole non negoziabili

Ogni violazione è un difetto bloccante in revisione.

**Privacy e rete**

- R1. Mai persistere, loggare o trasmettere PCM, stream ID, token o trascrizioni. L'audio vive solo in RAM durante la sessione.
- R2. Mai chiamate di rete in runtime: niente telemetria, CDN, font remoti, codice remoto, `eval`, `new Function`. Tutto è nel bundle.
- R3. Mai identificare o classificare persone. Nessuna funzione tipo `identifySpeaker()`. Le etichette dei parlanti sono solo manuali.

**Chrome e YouTube**

- R4. Mai leggere classi DOM, variabili o API interne non documentate del player YouTube. Solo l'elemento `<video>` standard e i suoi eventi.
- R5. Mai alterare, saltare o bloccare pubblicità, DRM o flussi del player. Mai scaricare media.
- R6. In `action.onClicked`, `chrome.sidePanel.open()` è la prima istruzione, sincrona, prima di qualunque `await` (ADR-0002).
- R7. L'offscreen document si crea con i soli motivi `USER_MEDIA` e `WORKERS`. Mai `AUDIO_PLAYBACK` (ADR-0003).
- R8. Ogni sessione di cattura scheda è protetta dal watchdog di heartbeat (ADR-0004). Nessuna cattura deve sopravvivere a stop, chiusura della scheda o navigazione fuori da `/watch`.
- R9. Nessun permesso nuovo nel manifest senza ADR approvato.

**Determinismo e scienza**

- R10. I pacchetti puri (`contracts`, `dsp-core`, `calibration`, `crystal-core`, `renderer-svg`, `comparator`) non importano API `chrome.*`, DOM, `window` né Three.js, e girano in Node.
- R11. In `crystal-core` sono vietati `Math.random`, `Date`, clock, stato globale e, nel percorso che produce vertici, `Math.sin/cos/tan/exp/pow/log` e simili (ADR-0010). Il lint lo verifica.
- R12. Il seed canonico è una tupla di sei interi in [0, 10000]. Mai float nel seed persistito.
- R13. Mai `null` convertito implicitamente in 0. Un descrittore non misurabile resta `null` fino alla decisione esplicita (`INSUFFICIENT_DATA` o confidenza bassa).
- R14. **Mai dichiarare un risultato non osservato.** Se un test non è stato eseguito (es. E2E in Chrome reale non disponibile nell'ambiente), scrivilo: «non eseguito: motivo». Mai inventare numeri di benchmark, tassi di errore o esiti di dataset.
- R15. Le soglie `[H]` si cambiano solo con un dato misurato e una riga in `docs/BENCHMARK_PROTOCOL.md` o in un report di gate.

**Dati e contenuti**

- R16. Nel repository niente audio di persone reali né clip protette. Solo fixture sintetiche generate da script (`scripts/fixtures/`). I dataset umani stanno fuori dal repository, con consenso documentato.
- R17. Titoli, metadati e file importati sono testo non fidato: `textContent`, mai `innerHTML`; validazione di schema in import.

## 5. Mappa del repository

```text
AGENTS.md  CLAUDE.md  README.md  CONTRIBUTING.md
docs/       SPEC_v0.3.md, ADR/, BACKLOG.md, GATES.md, STATUS.md,
            RISK_REGISTER.md, BENCHMARK_PROTOCOL.md, LEGAL_G0_CHECKLIST.md,
            ADVERSARIAL_REVIEW.md, GLOSSARY.md, archive/
extension/  manifest, service worker, content script, offscreen, side panel, collection
packages/   contracts, dsp-core, calibration, crystal-core, renderer-three,
            renderer-svg, comparator, vault
tests/      fixtures/, unit/, integration/, e2e/, benchmarks/
scripts/    fixtures/, golden/ (generazione fixture e seed dorati)
```

Le directory `extension/`, `packages/crystal-core/` e `packages/dsp-core/` hanno un proprio `CLAUDE.md` con regole locali: leggilo quando lavori lì.

## 6. Stack e comandi

Stack fissato (SPEC §4): TypeScript `strict`, ES Modules, pnpm workspaces, Vite multi-entry per MV3, Vitest + fast-check, Playwright, Three.js, Tailwind compilato localmente. Node: versione LTS attiva, fissata in `.nvmrc`.

I comandi sotto sono creati dalla issue I-01. Se non esistono ancora, la tua issue è I-01 o dipende da essa.

| Comando | Effetto |
|---|---|
| `pnpm install` | Dipendenze (lockfile obbligatorio, `--frozen-lockfile` in CI) |
| `pnpm typecheck` | `tsc --noEmit` su tutti i pacchetti |
| `pnpm lint` | ESLint + regole di purezza (R10, R11) |
| `pnpm test` | Unit e property test (Vitest), solo Node |
| `pnpm test:golden` | Hash dei seed dorati in Node; `pnpm test:golden:browsers` in Chrome e Firefox via Playwright |
| `pnpm fixtures` | Rigenera le fixture sintetiche in `tests/fixtures/` |
| `pnpm build` | Bundle dell'estensione in `dist/extension/` |
| `pnpm test:e2e` | Playwright con Chrome reale e estensione caricata (richiede display; vedi `CLAUDE.md`) |
| `pnpm bench` | Benchmark DSP offline, output in `tests/benchmarks/out/` |

Prima di ogni commit: `pnpm typecheck && pnpm lint && pnpm test`.

## 7. Come si lavora su una issue

1. Leggi `docs/STATUS.md` e la issue in `docs/BACKLOG.md`. Verifica che le dipendenze siano chiuse.
2. Leggi solo le sezioni della specifica e gli ADR citati dalla issue.
3. Scrivi un piano breve: file toccati, test da aggiungere, rischi. Se tocca un `[F]`, un permesso o una dipendenza nuova, fermati e chiedi.
4. Per i pacchetti puri: test prima (fixture, property test, seed dorati), poi codice.
5. Implementa in passi piccoli; esegui typecheck, lint e test a ogni passo.
6. Verifica la Definition of Done della issue **e** quella globale (sotto).
7. Aggiorna: `docs/STATUS.md`, `CHANGELOG.md` (sezione Unreleased), `docs/RISK_REGISTER.md` se un rischio cambia stato.
8. Apri la PR con il template; nella sezione «Evidenze» separa ciò che è verificato da ciò che non è stato eseguito.

**Una issue per branch, una PR per issue.** Branch: `issue/I-07-split-half`. Niente refactoring non richiesti fuori dal perimetro della issue: annotali in `docs/STATUS.md` come proposta.

## 8. Definition of Done globale

Una issue è chiusa solo se:

- [ ] DoD specifica della issue soddisfatta, con evidenza (output dei test, screenshot, numeri misurati).
- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` verdi.
- [ ] Nuovo comportamento coperto da test; bug corretti hanno un test di regressione.
- [ ] Nessuna violazione delle regole R1–R17.
- [ ] Nessuna nuova dipendenza senza nota di licenza, dimensione e motivazione nella PR (licenze ammesse: MIT, BSD, Apache-2.0, ISC, OFL per i font, Zlib). L'elenco vale per ciò che entra nel bundle distribuito (`dist/`). Le dipendenze di sviluppo, anche transitive, che non entrano nel bundle possono avere altre licenze open source (es. MPL-2.0, BlueOak-1.0.0), purché annotate nella PR (decisione D-B, 2026-11-09).
- [ ] Contratti in `packages/contracts` aggiornati se cambia un messaggio o un record; versione incrementata se cambia la semantica (`extractorVersion`, `mappingVersion`, `geometryVersion`, `comparatorVersion`, `schemaVersion`).
- [ ] Documentazione aggiornata (STATUS, CHANGELOG, ADR se c'è una decisione).
- [ ] Stringhe UI in italiano nel modulo centralizzato, mai inline.

## 9. Lingua e stile

- **Documentazione, stringhe UI, ADR:** italiano.
- **Identificatori, commenti nel codice, messaggi di commit:** inglese. Commit in formato Conventional Commits (`feat(dsp-core): add split-half stability`).
- TypeScript: niente `any`; unioni discriminate per messaggi e stati; `switch` esaustivi con `assertNever`; funzioni pure dove possibile; errori tipizzati, mai stringhe libere.
- Nomi dei descrittori: `p1_pitch`, `p2_intonation`, `p3_dynamics`, `p4_roughness`, `p5_brightness`, `p6_rhythm` (glossario in `docs/GLOSSARY.md`).

## 10. Quando fermarsi e chiedere a un umano

- Conflitto tra fonti, requisito impossibile, ambiguità che cambia un contratto.
- Modifica di un requisito `[F]`, di un permesso, della CSP o del manifest.
- Nuova dipendenza runtime oltre 100 KB minificati o con licenza fuori elenco.
- Qualunque questione legale, di privacy o di dati di persone reali.
- Un gate fallito o un test che smentisce un'ipotesi del progetto (riportalo: è un risultato, non un fallimento da nascondere).
- Dopo tre tentativi falliti sullo stesso problema.

## 11. Passaggio di consegne tra agenti e sessioni

Gli agenti non hanno memoria fra sessioni. Lo stato si passa solo tramite file:

- `docs/STATUS.md`: fase, issue attiva, ultimo stato verificato, blocchi, prossimo passo. Aggiornalo sempre prima di terminare.
- Descrizione della PR: cosa è fatto, cosa no, evidenze, rischi.
- `docs/RISK_REGISTER.md`: stato dei rilievi `VC-xx`.

Ai gate, la revisione è svolta da un agente diverso da quello che ha scritto il codice (vedi `docs/GATES.md`).
