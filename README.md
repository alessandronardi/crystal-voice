# VoiceCrystal

Estensione Chrome che trasforma un segmento di parlato in un cristallo 3D: una visualizzazione riproducibile di sei proprietà acustiche misurate, nello stile di una collezione mineralogica.

- **Sorgenti:** audio di una scheda YouTube, microfono, file locale.
- **Tutto in locale:** nessun backend, nessuna telemetria, nessun audio salvato.
- **Non è** un sistema di riconoscimento del parlante né un classificatore di emozioni.

> **Stato:** progettazione completata, sviluppo non iniziato. Fasi 1–3 autorizzate; distribuzione subordinata alla valutazione legale G0. Stato aggiornato in [`docs/STATUS.md`](docs/STATUS.md).

## Come orientarsi

| Se vuoi… | Leggi |
|---|---|
| Capire cosa si costruisce | [`docs/SPEC_v0.3.md`](docs/SPEC_v0.3.md) |
| Sapere perché è fatto così | [`docs/ADR/`](docs/ADR/) |
| Sapere cosa fare adesso | [`docs/STATUS.md`](docs/STATUS.md), [`docs/BACKLOG.md`](docs/BACKLOG.md) |
| Lavorare come agente di programmazione | [`AGENTS.md`](AGENTS.md), [`CLAUDE.md`](CLAUDE.md) |
| Contribuire come persona | [`CONTRIBUTING.md`](CONTRIBUTING.md) |
| Sapere quando si passa di fase | [`docs/GATES.md`](docs/GATES.md) |
| Conoscere i rischi | [`docs/RISK_REGISTER.md`](docs/RISK_REGISTER.md), [`docs/ADVERSARIAL_REVIEW.md`](docs/ADVERSARIAL_REVIEW.md) |
| Calibrare o misurare | [`docs/BENCHMARK_PROTOCOL.md`](docs/BENCHMARK_PROTOCOL.md) |
| Preparare la valutazione legale | [`docs/LEGAL_G0_CHECKLIST.md`](docs/LEGAL_G0_CHECKLIST.md) |
| Capire un termine | [`docs/GLOSSARY.md`](docs/GLOSSARY.md) |

## Roadmap

| Fase | Contenuto | Gate di uscita |
|---|---|---|
| 1 | PoC cattura (scheda, microfono, file), watchdog | G-PoC |
| 2 | DSP offline, fixture, dataset, calibrazione | G1 |
| 3 | Generatore a semispazi, vetrina 3D, tavola SVG | G2 |
| — | Valutazione legale | **G0** |
| 4 | Pannello, Collezione, archivio, confronto | Release |
| 5 | Hardening e distribuzione | Release |

## Comandi

Disponibili dopo la issue I-01: `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e`, `pnpm fixtures`, `pnpm bench`. Dettagli in `AGENTS.md` §6.

## Licenza

Da definire prima della prima release pubblica.
