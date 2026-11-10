# ADR-0017: Range dello stimatore f0 esteso a 60–1100 Hz per il canto; il frame intonato resta 60–500 Hz

- **Stato:** Accettato
- **Data:** 2026-11-10
- **Decisori:** product owner (decisione in chat il 2026-11-10, domanda 3 della revisione di I-05a)

## Contesto

SPEC §7.4 definisce il «frame intonato» con `f0Hz` in [60, 500] Hz e `pitchConfidence ≥ 0,8` [H]. Da questi frame si calcolano p1, p2 e p4. `packages/dsp-core/CLAUDE.md` fissava lo stesso range anche per lo stimatore YIN.

**Fatti verificati (I-05a, 2026-11-10)**
- Con il range 60–500 Hz, la revisione avversariale ha mostrato che YIN ripiegava le f0 più alte un'ottava sotto, con confidenza alta: 600 Hz diventava 300 Hz con confidenza 0,997. La prima correzione restituiva `null` sopra i 500 Hz.
- Il product owner non vuole `null` sul canto. La sorgente YouTube include contenuti cantati, e una nota di soprano arriva a circa 1050 Hz (C6).
- Dopo l'estensione, M2 sulle voci sintetiche è invariato: errore relativo mediano 0,21%, errori d'ottava 0%, 2861 frame.
- Aumentano i frame «falsi sonori», cioè senza voce nella verità ma con f0 stimata: voice-a dal 4,35% al 6,83%, voice-a-long dal 5,30% al 7,57%, voice-b dall'11,71% al 13,81%. Sono soprattutto code e attacchi delle sillabe.

## Decisione

1. **Range dello stimatore:** YIN stima f0 in [60, 1100] Hz, con una tolleranza dello 0,5% sui bordi. Le f0 fuori range restano `null`: non si ripiegano mai dentro il range. La ricerca dei dip parte da 2200 Hz, così ciò che sta sopra 1100 Hz viene riconosciuto e scartato.
2. **Frame intonato invariato:** per i descrittori resta [60, 500] Hz (SPEC §7.4, [H]). Le costanti `INTONATED_MIN_HZ` e `INTONATED_MAX_HZ` stanno in `packages/dsp-core/src/config.ts` e il filtro si applica in I-06. Il canto sopra i 500 Hz è quindi misurato e visibile nella traccia, ma non entra in p1, p2 e p4.
3. **Revisione in I-06:** se e come far contare il canto nei descrittori si decide in I-06 o in G1, con dati misurati (R15). Gli ancoraggi di `mapping-0` per p1 arrivano a 320 Hz: oggi le note acute saturerebbero comunque p1.

## Conseguenze

**Positive**
- Il canto produce una traccia di pitch, non un vuoto. Le euristiche di I-06, per esempio quella sulla musica, possono usarla.
- Nessun errore d'ottava ripiegato fra 500 e 1100 Hz.

**Negative**
- Più frame sonori spuri sul parlato, ai margini delle sillabe. I-06 deve applicare il filtro del frame intonato e contare questi frame nella confidenza.
- A 16 kHz, 1100 Hz corrisponde a un periodo di circa 14,5 campioni: la risoluzione di τ è più grossolana in alto. I toni fino a 1100 Hz restano comunque entro lo 0,5% (test `yin.test.ts`).
- Il costo DSP per frame è invariato: τmax non cambia.

## Alternative scartate

- **`null` sopra 500 Hz:** scartata dal product owner, perché il canto sparirebbe.
- **Estendere anche il frame intonato:** rimandato. Senza dati, sposterebbe p1 e p2 per i contenuti cantati, e le note acute saturerebbero p1.
- **1600 Hz:** più rischio di agganciare armoniche o formanti sul parlato, senza un caso d'uso dichiarato.

## Verifica

- `packages/dsp-core/test/yin.test.ts`: toni fino a 1100 Hz entro lo 0,5%; toni armonici a 660, 880 e 1046 Hz senza errori d'ottava; `null` a 1120, 1200, 1500 e 2000 Hz e sotto i 60 Hz.
- `pnpm bench`: M2 e quota di falsi sonori registrati in `docs/BENCHMARK_PROTOCOL.md` §7.

## Riferimenti

- SPEC §7.3, §7.4; ADR-0016; revisione avversariale di I-05a (rilievo M2 e domanda 3), riassunta in `docs/STATUS.md`.
