# Registro dei rischi

Stato dei 23 rilievi della revisione avversariale del 9 novembre 2026 (`docs/ADVERSARIAL_REVIEW.md`). Aggiornare **Stato** ed **Evidenza** quando una issue chiude o un test smentisce un'ipotesi.

**Stati:** Aperto → Mitigazione pianificata → Mitigato (con evidenza) → Chiuso. Oppure Accettato (rischio residuo consapevole, con motivazione).

| ID | Sev. | Rischio | Mitigazione | Issue | ADR | Stato | Evidenza |
|---|---|---|---|---|---|---|---|
| VC-01 | BLOCKER | Termini YouTube e policy dello store | G0; doppia sorgente | I-16 | 0009 | Mitigazione pianificata | — |
| VC-02 | CRITICAL | Avvio: gesto perso o `onClicked` non ricevuto | `sidePanel.open()` sincrono | I-02 | 0002 | Mitigazione pianificata | — |
| VC-03 | CRITICAL | Offscreen chiuso dopo 30 s di pausa | Motivi `USER_MEDIA`, `WORKERS` | I-02 | 0003 | Mitigazione pianificata | — |
| VC-04 | CRITICAL | Cattura dopo navigazione esterna | Watchdog heartbeat | I-03 | 0004 | Mitigazione pianificata | — |
| VC-05 | CRITICAL | Numero di lati instabile per la stessa voce | Semispazi, cammino continuo | I-10 | 0005 | Mitigazione pianificata | — |
| VC-06 | CRITICAL | Affinità gonfiata (60–80% per sconosciuti) | Percentile di vicinanza | I-09, I-15 | 0007 | Mitigazione pianificata | — |
| VC-07 | HIGH | Convergenza per inerzia | Split-half | I-07 | 0008 | Mitigazione pianificata | — |
| VC-08 | HIGH | Hash che cambia con il motore JS | Quantizzazione, trig propria | I-10 | 0010 | Mitigazione pianificata | — |
| VC-09 | HIGH | Annunci non riconoscibili senza DOM interno | Eventi media standard, limite dichiarato | I-03 | — | Accettato (residuo) | — |
| VC-10 | HIGH | «Volume stabile» altera `p3` | Misura e dichiarazione | I-06 | — | Aperto | — |
| VC-11 | HIGH | Musica scambiata per voce | Confronto VAD, euristica, tratti velati | I-05, I-06 | 0014 | Mitigazione pianificata | — |
| VC-12 | HIGH | Parlanti alternati fusi | Avviso + conferma | I-06, I-13 | — | Mitigazione pianificata | — |
| VC-13 | HIGH | Descrittori correlati o dipendenti dal microfono | Residuo di `p5`, confidenza | I-06, I-09 | 0006, 0014 | Aperto | — |
| VC-14 | HIGH | Stati senza uscita | Due macchine a tabella | I-03 | 0011 | Mitigazione pianificata | — |
| VC-15 | MEDIUM | Simmetrie non cristallografiche | Solo assi 2, 3, 4, 6 | I-10 | 0005 | Mitigazione pianificata | — |
| VC-16 | MEDIUM | Stato perso alla terminazione del SW | `chrome.storage.session` | I-03 | 0001 | Mitigazione pianificata | — |
| VC-17 | MEDIUM | Contratti incompleti | SPEC §9 v0.3 | I-01 | — | Mitigato | SPEC v0.3 §9 |
| VC-18 | MEDIUM | Quota per PNG nel record | Miniature WebP, rigenerazione | I-14 | — | Mitigazione pianificata | — |
| VC-19 | MEDIUM | Latenza del pass-through; player muto | Misura; avviso `PLAYER_MUTED` | I-02, I-06 | — | Aperto | — |
| VC-20 | MEDIUM | Dati personali di terzi | Avviso all'export; G0 | I-14 | — | Aperto | — |
| VC-21 | MEDIUM | Timeout assoluto mancante | 120 s | I-03 | — | Mitigato | SPEC v0.3 §6 |
| VC-22 | LOW | Pannello troppo stretto | Collezione a tutta scheda | I-15 | — | Mitigazione pianificata | — |
| VC-23 | LOW | Motivo `WORKERS` necessario? | Incluso per prudenza | I-02 | 0003 | Mitigato | SPEC v0.3 §5 |

## Rischi di progetto (non tecnici)

| ID | Rischio | Probabilità | Impatto | Risposta |
|---|---|---|---|---|
| PR-01 | Dataset umano difficile da raccogliere (consenso, tempo) | Media | Alto: G1 bloccato | Iniziare la raccolta in parallelo alla fase 1; usare la sorgente microfono come strumento di raccolta |
| PR-02 | Parere legale lento o costoso | Media | Alto: fase 4 bloccata | Avviare G0 subito; le fasi 1–3 non dipendono da G0 |
| PR-03 | Agenti che dichiarano test non eseguiti | Media | Alto: falsa sicurezza | R14, verbali con evidenza, revisore indipendente |
| PR-04 | Resa estetica deludente dopo G1 | Bassa | Medio | Catalogo di 200 seed e revisione estetica in G2 |
| PR-05 | Cambi delle API Chrome | Bassa | Medio | `minimum_chrome_version`; verifica documentazione a ogni gate |
