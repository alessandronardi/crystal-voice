# ADR-0011: Macchina di cattura separata dalla macchina della vista

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

La v0.2 mescolava stati di cattura e di interfaccia (`SAVED`, `COMPARING`) e lasciava stati terminali senza uscita (VC-14).

## Decisione

- Macchina di cattura nell'offscreen, autorevole, con stati terminali che tornano sempre a `IDLE`.
- Macchina della vista nella UI: `HOME`, `LIVE`, `REVEALED`, `SAVED`, `OUTCOME`, `COLLECTION`, `COMPARING`.
- Entrambe implementate come tabelle di transizione tipizzate e testate a modello.

## Conseguenze

Responsabilità chiare; la UI può essere riaperta senza perdere la cattura.

## Alternative scartate

Una sola macchina (v0.2).

## Verifica

Test a modello: ogni stato raggiunge `IDLE`; `stop()` da ogni stato (I-03).

## Riferimenti

SPEC §6
