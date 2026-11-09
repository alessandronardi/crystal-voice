# ADR-0003: Offscreen con motivi `USER_MEDIA` e `WORKERS`, mai `AUDIO_PLAYBACK`

- **Stato:** Accettato
- **Data:** 2026-11-09
- **Decisori:** product owner; revisione avversariale del 2026-11-09

## Contesto

Con il motivo `AUDIO_PLAYBACK` Chrome chiude l'offscreen dopo 30 s senza audio; gli altri motivi non hanno limiti di durata. Un video in pausa produce silenzio (VC-03).

## Decisione

- `chrome.offscreen.createDocument({ reasons: ['USER_MEDIA', 'WORKERS'], ... })`.
- Una chiusura inattesa dell'offscreen porta la sessione a `ERROR / OFFSCREEN_CLOSED` e l'UI lo mostra.
- L'offscreen si chiude esplicitamente a fine sessione dopo il rilascio delle risorse.

## Conseguenze

La sessione sopravvive alle pause fino al timeout assoluto di 120 s.

## Alternative scartate

Includere `AUDIO_PLAYBACK` perché l'offscreen riproduce audio: introduce la chiusura a 30 s.

## Verifica

Pausa di 60 s e ripresa (scenario S2): sessione viva, audio udibile.

## Riferimenti

[offscreen](https://developer.chrome.com/docs/extensions/reference/offscreen)
