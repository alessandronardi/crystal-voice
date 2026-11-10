# ADR-0016: Mix mono come media dei canali, con ripiego su un canale e warning se le fasi si cancellano

- **Stato:** Accettato (2026-11-10)
- **Data:** 2026-11-10
- **Decisori:** product owner (indirizzo approvato in chat il 2026-11-10; ADR accettato in chat il 2026-11-10, con la modifica al punto 2 registrata sotto)

**Modifica all'accettazione (2026-11-10):** la prima stesura rilevava la cancellazione «sui frame utili» (SPEC §7.4). I frame utili dipendono dal VAD, che lavora sul segnale già mixato: la definizione era circolare. Il punto 2 usa ora i frame attivi per energia.

## Contesto

SPEC §7.1 [F] chiede di convertire lo stereo in mono «con regole documentate e testate» e di «verificare casi con canali fuori fase», ma non fissa la regola. SPEC §15 elenca lo «stereo fuori fase» fra le fixture sintetiche.

**Fatti verificati (I-04, 2026-11-10)**
- La fixture `voice-a-antiphase` ha il canale destro uguale all'opposto del sinistro. La quantizzazione int16 è simmetrica, quindi la somma L+R è esattamente zero (test `tests/unit/fixtures/generators.test.ts`).
- Con la media dei canali, l'unica regola ovvia, il segnale mono di questa fixture è silenzio digitale. La pipeline risponderebbe «nessuna voce» a una clip in cui ogni canale contiene parlato udibile.
- `QualityWarning` (SPEC §9, `packages/contracts/src/messages.ts`) non ha un warning per questo caso.
- La revisione avversariale di I-04 ha segnalato che il meta della fixture non può dichiarare un esito atteso senza una base nella SPEC o in un ADR. Per questo oggi c'è `expectedOutcome: null`.

**Ipotesi [H]**
- Nei contenuti reali la cancellazione è di solito parziale: un canale invertito con guadagni diversi, o solo una parte dello spettro in controfase. La soglia di rilevamento va misurata, non scelta a priori.
- Una soglia di partenza di 20 dB di calo dell'RMS mono rispetto ai canali separa la controfase completa dallo stereo normale (dove il calo è vicino a 0 dB per sorgenti centrate, e al massimo di circa 3 dB per sorgenti scorrelate). Da verificare in I-05 sulle fixture.

## Decisione

1. **Regola di base:** mono = (L + R) / 2 campione per campione. Con un solo canale, mono = quel canale.
2. **Rilevamento:** sui frame attivi per energia (frame da 20 ms in cui l'RMS del canale più forte supera −60 dBFS [H]), calcolare `cancellationDb = 20·log10(rmsMedioCanali / rmsMono)`, dove `rmsMedioCanali` è la media quadratica degli RMS dei canali. Se la mediana di `cancellationDb` sui frame attivi supera `PHASE_CANCELLATION_DB` [H] (valore iniziale 20 dB), la cancellazione è dichiarata. Un frame con RMS mono nullo conta come cancellazione oltre ogni soglia.
3. **Ripiego:** quando la cancellazione è dichiarata, il segnale di analisi diventa il canale con l'RMS più alto, per tutta la sessione. La scelta del canale avviene una volta, in modo deterministico: a parità vince il canale 0.
4. **Warning:** si aggiunge `PHASE_CANCELLATION` a `QualityWarning`. Il cristallo resta valido e porta il warning; il cartellino lo dichiara con un testo del modulo centralizzato delle stringhe.
5. **Fixture:** con questo ADR accettato, il meta di `voice-a-antiphase` dichiara `expectedOutcome` = voce trovata con `PHASE_CANCELLATION`. Si aggiunge una fixture di controfase parziale (canale invertito a −6 dB), per misurare la soglia.
6. **Dove:** regola e rilevamento stanno in `dsp-core`, con implementazione e test in I-05 (che ha il mix mono nel perimetro). La soglia sta nel file di configurazione unico di `dsp-core` (`packages/dsp-core/src/config.ts`).

## Conseguenze

**Positive**
- Una clip con la fase invertita produce un cristallo invece di un falso «nessuna voce», e il difetto della catena resta visibile all'utente.
- La regola è deterministica e verificabile in Node sulle fixture.

**Negative**
- Contratto: `QualityWarning` cambia. Vanno aggiornati SPEC §9 e `packages/contracts/src/messages.ts`; nessun record persistito esiste ancora, quindi non serve migrazione.
- Usare un solo canale butta via metà del segnale: se i canali contengono sorgenti diverse, il ripiego può scegliere quella sbagliata. Rischio accettato perché segnalato dal warning.
- Una soglia [H] in più da calibrare (R15).
- Versioni: l'introduzione arriva con la prima `extractorVersion` (I-06); ogni modifica successiva della regola o della soglia la incrementa.

## Alternative scartate

- **Scartare con `INSUFFICIENT_DATA`:** più semplice, ma l'utente sente la voce e il prodotto gli risponde «nessuna voce». Inoltre il motivo del rifiuto non sarebbe spiegabile con i warning attuali.
- **Ripiego silenzioso su un canale, senza warning:** nasconde un difetto della catena e cambia l'input del DSP senza che il cartellino lo dica.
- **Invertire un canale e risommare:** ricostruisce il segnale solo se l'inversione è esatta; con contenuti misti amplifica la cancellazione di ciò che era in fase.
- **Analizzare i canali separatamente e unire i descrittori:** raddoppia il costo DSP e richiede una regola di fusione dei descrittori che la SPEC non prevede.

## Verifica

- I-05: unit test su `voice-a-antiphase` (voce trovata, `PHASE_CANCELLATION`, canale scelto deterministico), su `voice-a` duplicato in stereo in fase (nessun warning, mono identico al canale) e sulla fixture di controfase parziale (valore di `cancellationDb` misurato e riportato).
- Property test: per segnali uguali sui due canali il mono coincide con il canale. Il risultato non deve dipendere dall'ordine dei blocchi: la proprietà si verifica quando esisterà un percorso a blocchi (worker, I-03/I-06). Oggi `mixToMono` lavora solo sul buffer intero, e una regola di decisione fra blocchi va definita allora.
- Il valore di `PHASE_CANCELLATION_DB` si conferma o si cambia con una misura registrata in `docs/BENCHMARK_PROTOCOL.md`.

## Riferimenti

- SPEC §7.1, §7.4, §9, §15.
- `tests/fixtures/README.md` (limiti noti, controfase); revisione avversariale di I-04 (rilievo M3), riassunta in `docs/STATUS.md`.
