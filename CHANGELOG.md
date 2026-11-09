# Changelog

Formato [Keep a Changelog](https://keepachangelog.com/it/1.1.0/); versioni [SemVer](https://semver.org/lang/it/). Le versioni semantiche dei dati (`extractorVersion`, `mappingVersion`, `geometryVersion`, `comparatorVersion`, `schemaVersion`) si annotano accanto alla voce che le cambia.

## [Unreleased]

### Aggiunto
- Specifica v0.3 con decisioni D1–D5 e modifiche Δ1–Δ21.
- ADR 0001–0014, backlog I-01…I-18, gate, registro dei rischi, protocollo di benchmark, checklist G0, glossario.
- `AGENTS.md`, `CLAUDE.md` e regole locali per `extension/`, `packages/dsp-core/`, `packages/crystal-core/`.
- Configurazione Claude Code: revisore avversariale, comandi `/gate-check`, `/new-adr`, `/session-end`.
- I-01: monorepo pnpm (Node 24, TypeScript `strict`) con gli otto pacchetti di SPEC §4, vuoti ma tipizzati.
- I-01: `packages/contracts` con i tipi di SPEC §9 trascritti alla lettera, guardie `isCrystalSeed`/`isSeedUnits`, `assertNever`, messaggio diagnostico `PING`/`PONG` separato da `CaptureMessage`.
- I-01: build MV3 multi-entry con Vite (service worker, content script IIFE, offscreen, worklet, worker, side panel, collezione, permesso) e Tailwind compilato localmente; manifest v0.3 di SPEC §5.
- I-01: guardia sul bundle **minificato**. `pnpm build` fallisce per:
  - gli identificatori `eval` e `Function` ovunque compaiano;
  - schemi URL nel codice, anche dentro template e concatenazioni, e nei file HTML, SVG, CSS e JSON;
  - tipi di file non scansionati;
  - CSP non conforme;
  - permessi, chiavi di manifest e match dei content script fuori da un elenco ammesso;
  - file referenziati mancanti.

  I falsi positivi si gestiscono con eccezioni motivate (`GUARD_EXCEPTIONS`, oggi vuoto). È un controllo testuale, non una prova: a runtime la CSP blocca l'esecuzione dinamica, non la rete (decisione D-A in STATUS).
- I-01: regole ESLint di purezza (R10, R11, R17, ADR-0010), con fixture non conformi e test che dimostrano che ogni regola scatta. Coprono:
  - i pacchetti puri: globali di browser, estensione, Node e rete; import di Node, Three.js e codice impuro; `import()`;
  - tutto `crystal-core`: casualità, orologi, `let`/`var` di modulo, alias di `Math` e `crypto`;
  - il percorso dei vertici: solo membri `Math` ammessi, nessun accesso indiretto a `Math`, nessun import con `..`.

  Limite dichiarato: lo stato mutabile dentro `const` non viene rilevato.
- I-01: E2E Playwright «estensione caricata, il service worker risponde al ping»; `tests/e2e/README.md`; voce M0 nella checklist manuale.
- I-01: workflow CI GitHub Actions (typecheck, lint, test, build, E2E sotto xvfb).
