# ADR-0030: Rinuncia a I-08 / I-09 (Gate G1), mantenimento di mapping/comparator v0 e rimozione dello stato «sperimentale»

- **Stato:** Accettato (2026-11-15, decisione esplicita del product owner)
- **Data:** 2026-11-15
- **Decisori:** product owner

## Contesto

- Il product owner ha comunicato il 2026-11-15 l'esito positivo di tutte le prove manuali e dichiarato di ritenere il progetto già funzionale e soddisfacente nella forma attuale.
- Il product owner ha deciso di **non procedere** con la raccolta di campioni vocali umani (`I-08`), di evitare la raccolta di moduli di consenso per volontari (`G0-DOC-04`) e di non ricalcolare tabelle `mapping-1` / `comparator-1` (`I-09`).
- Restano vincolanti le regole di progetto `R5` (nessun download di media) e `R16` (nel repository niente audio di persone reali né clip protette; eventuali dataset umani richiedono consenso documentato fuori dal repository).
- In `docs/SPEC_v0.3.md` (§§7.4, 7.5, 11, 15, 16) e in `docs/GATES.md` (`G1`), `extractor-0-experimental`, `mapping-0-experimental` e `comparator-0-experimental` esponevano avvisi e badge «sperimentale / pre-G1 / non calibrata» in attesa di `I-08` e `I-09`.

## Decisione

1. **Rinuncia formale a `I-08` e `I-09` (deroga su `G1`):**
   - Le issue `I-08` (Dataset umano + report G1) e `I-09` (Tabelle quantili `mapping-1` e `comparator-1`) vengono chiuse come **rinunciate (fuori perimetro v1)** in `docs/BACKLOG.md`.
   - Il Gate `G1` (`docs/GATES.md`) è chiuso per deroga esplicita del product owner senza raccolta vocale su volontari (`docs/SPEC_v0.3.md` §15, §16).
2. **Effetto su `G0-DOC-04`:**
   - Non essendoci alcuna raccolta di registrazioni vocali da volontari, l'azione `G0-DOC-04` in `docs/gates/G0-valutazione-2026-11-13.md` (§4.3) è contrassegnata come **non applicabile** e non blocca il completamento di G0.
3. **Conservazione integrale della matematica attuale:**
   - Le formule e soglie di `@voicecrystal/dsp-core`, la tabella quantile lineare fra gli ancoraggi di `SPEC` §7.5 (`packages/calibration/mapping-0.json`, generata da `scripts/calibration/build-mapping-0.ts`) e la distribuzione empirica su `200.000` coppie uniformi del comparatore (`packages/comparator/comparator-0.json`, generata da `scripts/calibration/build-comparator-0.ts`) restano **matematicamente identiche bit per bit**.
4. **Rimozione della designazione di «sperimentale»:**
   - Le versioni canoniche diventano **`extractor-0`**, **`mapping-0`** e **`comparator-0`** (rinominando i JSON `mapping-0.json` e `comparator-0.json` con `"experimental": false`).
   - `extractDescriptors`/`describeFrames` (`packages/dsp-core/src/extractor.ts`) e `seedFromRaw` (`packages/calibration/src/mapping.ts`) non emettono più `EXPERIMENTAL_MAPPING`; `compareSeeds`/`compareSpecimens` (`packages/comparator/src/compare.ts`) non emettono più `EXPERIMENTAL_COMPARATOR` né `experimental: true`.
   - In `@voicecrystal/contracts` i letterali `'EXPERIMENTAL_MAPPING'` e `'EXPERIMENTAL_COMPARATOR'` restano ammessi nello schema `v1` esclusivamente per compatibilità di lettura di archivi/export storici.
   - In `extension/src/ui/strings.it.ts`, `extension/src/sidepanel/shell.ts` e `tests/unit/g0-notice.test.ts` vengono rimossi i badge, i sottotitoli e le etichette «sperimentale», «non calibrata», «provvisori» e «pre-G1». In `G0-DOC-01` (`docs/gates/G0-valutazione-2026-11-13.md` §5.1 e Home dell'estensione) il titolo dell'avviso diventa **`Elaborazione 100% Locale.`**, preservando parola per parola la restante dichiarazione legale sulla natura 100% locale, artistica, non biometrica e priva di trasmissione o analisi delle emozioni.

## Conseguenze

- **Positive:** elimina lo stato «provvisorio/sperimentale» da tutta l'interfaccia utente e dai cartellini, sblocca il percorso verso `I-16` e il gate `Release` senza richiedere raccolta dati personali né moduli di consenso, e mantiene intatto tutto il comportamento audio/geometrico già validato.
- **Negative / limiti consapevoli accettati:** le soglie `[H]` (`τ = 6` in split-half `VC-07`, soglie musica `VC-11`, residuo `p5` `VC-13`, ancoraggi di `mapping-0` e curva `G` uniforme di `comparator-0` `VC-06`) non sono calibrate su un dataset di parlato umano né misurate su campioni fuori insieme. Il product owner accetta espressamente questi limiti residui in `docs/RISK_REGISTER.md` come proprietà dichiarate della scala di riferimento v0, fermo restando il divieto assoluto (`R3`, `G0-DOC-01`, `G0-DOC-02`) di presentare il cristallo o l'affinità come biometria o identificazione personale.
- **Modifiche alla specifica:** `docs/SPEC_v0.3.md` §§7.4, 7.5, 11, 15, 16 ricevono nota di prevalenza verso questo ADR.

## Alternative scartate

- **Raccogliere o scaricare tracce vocali da video YouTube in script offline:** viola le regole non negoziabili `R5` («Mai scaricare media») e `R16` (niente audio di persone reali o clip protette senza consenso documentato) oltre ai Termini di Servizio di YouTube (`G0-valutazione-2026-11-13.md` §3.1).
- **Mantenere i suffissi `-experimental` e i banner pre-G1 rinunciando a `I-08`/`I-09`:** incoerente con la decisione del product owner di considerare completa e non sperimentale la versione destinata al rilascio.

## Verifica

- `scripts/calibration/build-mapping-0.ts --check` e `scripts/calibration/build-comparator-0.ts --check`: integrità bit a bit dei quantili di `mapping-0.json` e `comparator-0.json`.
- `tests/unit/descriptors-fixtures.test.ts`: stessi `raw`, `confidence`, `music`, `speakers`, `gainDb` e `status` sulle fixture; aggiornati `version: 'extractor-0'` e assenza di `EXPERIMENTAL_MAPPING`.
- `tests/unit/g0-notice.test.ts`: corrispondenza letterale tra Home (`strings.it.ts`) e `docs/gates/G0-valutazione-2026-11-13.md` §5.1.
- Suite completa: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm test:e2e`.

## Riferimenti

- `docs/SPEC_v0.3.md` (§§7.4, 7.5, 11, 15, 16).
- `docs/GATES.md` (`G1`, `G0`).
- `docs/BACKLOG.md` (`I-08`, `I-09`, `I-15`).
- `docs/gates/G0-valutazione-2026-11-13.md` (§4.3 `G0-DOC-04`, §5.1 `G0-DOC-01`).
- `docs/RISK_REGISTER.md` (`VC-06`, `VC-07`, `VC-11`, `VC-13`, `PR-01`).
