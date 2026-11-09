# Revisione avversariale della specifica v0.2 — sintesi

- **Data:** 9 novembre 2026
- **Documento completo:** https://claude.ai/artifact/WJvDcE57MnHpFR1FpVDNPw (registro dei rilievi, scenari, test plan, matrice dei rischi, proposta)
- **Verdetto:** CONDITIONAL GO per le fasi 1–3; NO-GO per la distribuzione finché G0 non è chiuso.

## Rilievi

23 rilievi: 1 BLOCKER, 5 CRITICAL, 8 HIGH, 7 MEDIUM, 2 LOW. Stato corrente e mitigazioni in `docs/RISK_REGISTER.md`.

## Prove numeriche (simulazione su dati sintetici, non su voci reali)

- **Affinità fra seed casuali:** 200.000 coppie, pesi 1/6. Seed uniformi: media 60,4 (P5 44,1, P95 77,4). Seed gaussiani con media 50 e deviazione standard 15: media 79,7 (P5 69,3, P95 88,9).
- **Cambio del numero di lati con la formula v0.2:** per due misure della stessa voce con rumore gaussiano σ sul parametro, la quota di coppie con numero di lati diverso è 10% (σ = 1), 20% (σ = 2), 39% (σ = 4), 61% (σ = 8).

Lo script è riproducibile: `python3 scripts/review/sim_v02.py` (richiede numpy).

## Fonti verificate

- [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/offscreen): `AUDIO_PLAYBACK` chiude dopo 30 s senza audio; nessun limite per gli altri motivi; solo `chrome.runtime` disponibile.
- [chrome.tabCapture](https://developer.chrome.com/docs/extensions/reference/api/tabCapture): stream ID monouso e a breve scadenza; cattura mantenuta attraverso le navigazioni; audio della scheda silenziato durante la cattura.
- [chrome.sidePanel](https://developer.chrome.com/docs/extensions/reference/api/sidePanel): `open()` solo in risposta a un'azione dell'utente (Chrome 116+); `close()` da Chrome 141.
- [Termini di servizio di YouTube](https://www.youtube.com/terms).
