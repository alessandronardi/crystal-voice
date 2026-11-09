# Stato del progetto

> Aggiornato da ogni agente a fine sessione. In cima: le cose che il prossimo lettore deve sapere subito.

**Ultimo aggiornamento:** 2026-11-09 — impostazione della documentazione di progetto

## Sintesi

- **Fase corrente:** 0 → 1. Revisione avversariale chiusa; decisioni D1–D5 accettate; specifica v0.3 approvata per le fasi 1–3.
- **Gate:** G0 non avviato · G-PoC, G1, G2 non raggiunti.
- **Issue attiva:** nessuna. Prossima consigliata: **I-01**.
- **Codice:** nessuno ancora.

## Decisioni del product owner (9 novembre 2026)

| ID | Decisione | Scelta |
|---|---|---|
| D1 | Canale principale | Estensione con sorgente scheda + «La tua voce» (microfono, file) |
| D2 | Simmetria | Solo sistemi cristallini reali, con morph continuo |
| D3 | Parametri poco affidabili | Cristallo valido, tratto velato e dichiarato |
| D4 | Più voci | Avviso + conferma dell'utente |
| D5 | Affinità | Percentile di vicinanza |

## Prossimi passi

1. I-01 (scheletro e CI).
2. In parallelo, azioni umane: avviare G0 (`docs/LEGAL_G0_CHECKLIST.md`); preparare moduli di consenso e reclutamento per il dataset (I-08).
3. Dopo I-01: I-02 e I-04 in parallelo; I-10 può partire subito dopo I-01.

## Blocchi

- Fase 4 e 5 bloccate fino a G0.

## Verificato / non verificato

| Voce | Stato |
|---|---|
| Comportamento API Chrome (`sidePanel`, `tabCapture`, `offscreen`) | Verificato su documentazione il 9 nov 2026; **non** ancora in Chrome reale |
| Conflitto `openPanelOnActionClick` / `onClicked` | Segnalato dalla community; da verificare in I-02 |
| Microfono in offscreen dopo permesso in pagina estensione | Da verificare in I-17 |
| Automazione del gesto per `tabCapture` in Playwright | Da verificare in I-02 |
| Simulazioni della revisione (affinità, cambio lati) | Eseguite su dati sintetici; da confermare su dati reali in G1 |

## Proposte fuori perimetro

(nessuna)

## Registro sessioni

| Data | Agente | Issue | Esito | Note |
|---|---|---|---|---|
| 2026-11-09 | Claude | — | Documentazione di progetto | Spec v0.3, ADR 0001–0014, backlog, gate |
