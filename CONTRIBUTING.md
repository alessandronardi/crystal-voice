# Contribuire a VoiceCrystal

Le regole tecniche valgono per persone e agenti allo stesso modo: sono in [`AGENTS.md`](AGENTS.md). Qui c'è il processo.

## Flusso di lavoro

1. **Scegli una issue** da `docs/BACKLOG.md` con le dipendenze chiuse. Annotala come attiva in `docs/STATUS.md`.
2. **Branch** da `main`: `issue/I-07-split-half`.
3. **Commit** piccoli in [Conventional Commits](https://www.conventionalcommits.org/), in inglese: `feat(dsp-core): …`, `fix(extension): …`, `test(crystal-core): …`, `docs: …`, `chore: …`. Scope = nome del pacchetto o `extension`.
4. **Prima della PR:** `pnpm typecheck && pnpm lint && pnpm test`; per le issue Chrome anche E2E o checklist manuale.
5. **PR** con il template: una issue per PR, evidenze separate fra verificato e non eseguito.
6. **Revisione:** almeno una revisione umana. Per le PR che toccano cattura audio, watchdog, determinismo, storage o contratti, anche la revisione avversariale indipendente (`.claude/agents/adversarial-reviewer.md`).
7. **Merge** in squash. Aggiorna `CHANGELOG.md` (Unreleased) e `docs/STATUS.md`.

## Protezione di `main`

- CI obbligatoria verde (typecheck, lint, test, build).
- Almeno una approvazione.
- Nessun push diretto.

## Versioni semantiche dei dati

Oltre alla versione dell'estensione (SemVer), il progetto versiona la semantica dei dati (tabella in `docs/GLOSSARY.md`). Una PR che cambia l'output su un seed dorato, una formula o una tabella **deve** incrementare la versione corrispondente e mantenere leggibili i record precedenti.

## Decisioni

Ogni scelta che cambia un requisito `[F]`, un contratto, un permesso o aggiunge una dipendenza di peso passa da un ADR (`docs/ADR/0000-template.md`, stato `Proposto`) approvato dal product owner.

## Dati e audio

Nessun audio di persone reali nel repository. Le fixture sono sintetiche e generate da script. I dataset umani si gestiscono fuori repository secondo `docs/BENCHMARK_PROTOCOL.md`.
