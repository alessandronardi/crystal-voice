// The side panel screens of I-13a (SPEC §13, view machine of §6.2):
// home, listening as nucleation, revelation with the label, outcome. Style
// «Gabinetto di mineralogia» (D-AJ). The I-02…I-07 views (capture-view,
// file-view) keep their controls and technical rows: on the home screen they
// are the «La tua voce» card, on the other screens they move into «Dettagli
// tecnici». Text goes through textContent only (R17); the plate SVG is our
// own, parsed by renderer-three's fallback, never innerHTML.
import { DEFAULT_PLATE_VIEW, GEOMETRY_VERSIONS, type CaptureDiag, type CrystalGeometry, type CrystalSeed, type DescriptorKey, type SeedConfidence } from '@voicecrystal/contracts';
import { generateCrystalGeometry } from '@voicecrystal/crystal-core';
import { renderPlateSvg } from '@voicecrystal/renderer-svg';
import { chooseProfile, probeGpu, renderCrystal, showPlateFallback, type GpuProbe, type ProfileChoice, type ProfileInput, type RenderHandle } from '@voicecrystal/renderer-three';
import { CAPTURE_LIMITS } from '../offscreen/capture-machine.ts';
import { strings } from '../ui/strings.it.ts';
import { errorText, exitText, mountCaptureView } from './capture-view.ts';
import { mountFileView } from './file-view.ts';
import { labelWarnings, legendRows, veiledLines } from './legend.ts';
import { INITIAL_VIEW, viewTransition, type RevealedResult, type ViewEvent, type ViewOutcome, type ViewState } from './view-machine.ts';

const s = strings.shell;
/** The geometry of habit-1, the one version today (review L-2). */
const GEOMETRY_VERSION = GEOMETRY_VERSIONS[0];
/** The germ is drawn without veils: it is a sketch of the current estimates, not a result (review L-3). */
const GERM_CONFIDENCE: SeedConfidence = [1, 1, 1, 1, 1, 1];
/** [H] Showcase and germ sizes in CSS pixels, for a side panel about 360 px wide. */
const SHOWCASE_PX = 300;
const GERM_PX = 180;
/** [H] An answer to the several-voices notice that changed nothing after this long can be given again (review L-1). */
const ANSWER_RETRY_MS = 3_000;
/**
 * I-13b: the «Resa semplificata» option, kept across sessions in
 * chrome.storage.local (the `storage` permission is already declared). A
 * boolean only: nothing about the GPU is stored.
 */
export const RENDER_SIMPLIFIED_KEY = 'renderSimplified';

/** The licence texts copied into the package (extension/scripts/build.ts), G0-DOC-01. */
const LICENSES: readonly { label: string; href: string }[] = [
  { label: 'three.js (MIT)', href: 'THIRD_PARTY/three/LICENSE.txt' },
  { label: 'libfvad (BSD-3-Clause)', href: 'THIRD_PARTY/libfvad/LICENSE.txt' },
  { label: 'WebRTC PATENTS', href: 'THIRD_PARTY/libfvad/PATENTS.txt' },
  { label: 'Emscripten (MIT / NCSA)', href: 'THIRD_PARTY/emscripten/emscripten-LICENSE.txt' },
  { label: 'musl (MIT)', href: 'THIRD_PARTY/emscripten/musl-COPYRIGHT.txt' },
  { label: 'compiler-rt (Apache-2.0 con eccezione LLVM)', href: 'THIRD_PARTY/emscripten/compiler-rt-LICENSE.txt' },
  { label: 'dlmalloc (pubblico dominio)', href: 'THIRD_PARTY/emscripten/dlmalloc-NOTICE.txt' },
  { label: 'Tailwind CSS (MIT)', href: 'THIRD_PARTY/tailwindcss/LICENSE.txt' },
  { label: 'Spectral (SIL OFL 1.1)', href: 'THIRD_PARTY/spectral/OFL.txt' },
  { label: 'IBM Plex Mono (SIL OFL 1.1)', href: 'THIRD_PARTY/ibm-plex-mono/OFL.txt' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className !== '') e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

function button(label: string, className: string, testId: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className, label);
  b.type = 'button';
  b.dataset['testid'] = testId;
  b.addEventListener('click', onClick);
  return b;
}

/** A definition list whose values can be updated in place. */
function dataList(rows: readonly [string, string][]): { element: HTMLElement; values: HTMLElement[] } {
  const dl = el('dl', 'vc-data');
  const values: HTMLElement[] = [];
  for (const [k, v] of rows) {
    const dd = el('dd', '', v);
    values.push(dd);
    dl.append(el('dt', '', k), dd);
  }
  return { element: dl, values };
}

function geometryOf(seed: CrystalSeed, confidence: SeedConfidence): CrystalGeometry | null {
  try {
    return generateCrystalGeometry(seed, confidence, GEOMETRY_VERSION);
  } catch {
    return null; // a seed the generator refuses shows no crystal, never a wrong one
  }
}

const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The listening screen, built once per session and updated in place (review H-2: focus and clicks survive the ticks). */
interface LiveView {
  key: string;
  nodes: HTMLElement[];
  update(v: Extract<ViewState, { screen: 'LIVE' }>): void;
}

export function mountShell(root: HTMLElement): void {
  const shell = el('div', 'vc-shell');
  const screen = el('section');
  screen.dataset['testid'] = 'shell-screen';
  // Screen changes are announced once (SPEC §13 accessibility), not every progress tick.
  const announce = el('p', 'sr-only');
  announce.setAttribute('aria-live', 'polite');
  // Review M-3: a refused or failed start (not a YouTube video, busy, permission) on whatever screen is shown.
  const failure = el('div', 'vc-card');
  failure.dataset['testid'] = 'shell-start-failure';
  failure.setAttribute('role', 'alert');
  failure.hidden = true;
  const failureText = el('p', 'vc-text');
  failure.append(failureText);
  const tools = el('div', 'vc-tools');
  const tech = el('details', 'vc-details');
  tech.append(el('summary', '', s.details));
  shell.append(failure, screen, announce);
  root.replaceChildren(shell);

  let view: ViewState = INITIAL_VIEW;
  let showcase: { key: string; stage: HTMLElement; handle: RenderHandle | null; geometry: CrystalGeometry | null; choice: ProfileChoice } | null = null;
  let live: LiveView | null = null;
  let announced = '';
  // I-13b: rendering profile inputs. The GPU name lives only in this object, in memory (BACKLOG I-13 DoD).
  let simplified = false;
  let gpu: GpuProbe | null = null;
  /** The vetrina was too slow on its first frames (D-AN): economy for the rest of this panel (review L-7: no flicker at each reveal). */
  let slow = false;
  /** The legend row selected for the shown result (ADR-0028). */
  let selected: { result: string; key: DescriptorKey } | null = null;

  const dispatch = (event: ViewEvent): void => {
    const next = viewTransition(view, event);
    if (next === view) return;
    const leaving = view.screen === 'REVEALED' || view.screen === 'OUTCOME';
    view = next;
    // Review L-10 of I-13a: back home, the «La tua voce» card no longer shows the closed session's rows.
    if (leaving && next.screen === 'HOME') {
      capture.clearResult();
      file.clearResult();
    }
    render();
  };

  const capture = mountCaptureView(tools, {
    onDiag: (diag, source) => {
      dispatch({ type: 'CAPTURE_DIAG', diag, source });
    },
    onLost: (sessionId) => {
      dispatch({ type: 'CAPTURE_LOST', sessionId });
    },
    onStartFailure: (message, busy) => {
      failureText.textContent = message ?? '';
      failure.querySelector('button')?.remove();
      if (busy) failure.append(button(strings.capture.stopActive, 'vc-btn vc-btn-ghost', 'shell-stop-active', () => {
        capture.stopActive();
      }));
      failure.hidden = message === null;
    },
  });
  const file = mountFileView(tools, { onEvent: dispatch });

  void (async () => {
    try {
      const items = await chrome.storage.local.get(RENDER_SIMPLIFIED_KEY);
      const stored = items[RENDER_SIMPLIFIED_KEY] === true;
      if (stored === simplified) return;
      simplified = stored;
      if (view.screen === 'REVEALED') render();
    } catch {
      // No storage: the default (vetrina when the GPU allows it).
    }
  })();

  const disposeShowcase = (): void => {
    showcase?.handle?.dispose();
    showcase = null;
  };

  const homeScreen = (): HTMLElement[] => {
    const tab = el('div', 'vc-card');
    tab.append(el('p', 'vc-card-title', s.home.tabTitle), el('p', 'vc-text vc-muted', s.home.tabText));
    const voice = el('div', 'vc-card');
    voice.dataset['testid'] = 'shell-voice';
    voice.append(el('p', 'vc-card-title', s.home.voiceTitle), el('p', 'vc-text vc-muted', s.home.voiceText), tools);
    const notice = el('p', 'vc-note');
    notice.dataset['testid'] = 'shell-notice';
    const list = el('ul', 'vc-licenses');
    list.hidden = true;
    for (const l of LICENSES) {
      const a = el('a', 'vc-link', l.label);
      a.href = l.href;
      a.target = '_blank';
      a.rel = 'noopener';
      const li = el('li');
      li.append(a);
      list.append(li);
    }
    const toggle = button(s.home.licenses, 'vc-link', 'shell-licenses', () => {
      list.hidden = !list.hidden;
      toggle.setAttribute('aria-expanded', String(!list.hidden));
    });
    toggle.setAttribute('aria-expanded', 'false');
    notice.append(el('strong', '', s.home.noticeTitle), document.createTextNode(` ${s.home.noticeText} `), toggle, list);
    return [el('p', 'vc-cap', s.brand), el('h1', 'vc-title', s.home.title), el('p', 'vc-text vc-muted', s.home.lead), tab, voice, notice];
  };

  const buildLive = (v: Extract<ViewState, { screen: 'LIVE' }>): LiveView => {
    const caption = v.source === 'file' ? `${s.sources.file} «${v.fileName ?? ''}»` : s.sources[v.source];
    const stage = el('div', 'vc-stage vc-germ');
    stage.dataset['testid'] = 'shell-germ';
    const tag = el('span', 'vc-tag', s.live.provisional);
    const max = CAPTURE_LIMITS.maxValidSpeechMs;
    const rows: [string, string][] = v.source === 'file' ? [[s.live.state, '']] : [[s.live.validSpeech, ''], [s.live.state, '']];
    const list = dataList(rows);
    const bar = el('div', 'vc-bar');
    const fill = el('span');
    bar.append(fill);
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(max / 1000));
    bar.setAttribute('aria-label', s.live.validSpeech);
    const stop = button(s.live.stop, 'vc-btn vc-btn-ghost', 'shell-stop', () => {
      if (v.source === 'file') file.stop();
      else capture.stop();
    });
    // I-13b: the several-voices notice (SPEC §13 [F], D4): non-blocking, announced, two answers (D-AM).
    const m = s.multiSpeaker;
    const dialog = el('div', 'vc-dialog');
    dialog.dataset['testid'] = 'shell-multi-speaker';
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-modal', 'false');
    const question = el('p', 'vc-text', m.question);
    question.id = 'vc-multi-speaker-question';
    dialog.setAttribute('aria-labelledby', question.id);
    let answeredAt = -1;
    const answer = (single: boolean): void => {
      yes.disabled = true;
      no.disabled = true;
      answeredAt = performance.now();
      capture.answerMultiSpeaker(single);
    };
    const yes = button(m.yes, 'vc-btn', 'shell-multi-yes', () => {
      answer(true);
    });
    const no = button(m.no, 'vc-btn vc-btn-ghost', 'shell-multi-no', () => {
      answer(false);
    });
    const answers = el('div', 'vc-btns');
    answers.append(yes, no);
    dialog.append(question, answers);
    dialog.hidden = true;
    const confirmed = el('p', 'vc-text vc-muted', m.confirmed);
    confirmed.dataset['testid'] = 'shell-multi-confirmed';
    confirmed.hidden = true;
    const nodes: HTMLElement[] = [el('p', 'vc-cap', s.live.caption(caption)), el('h2', 'vc-h2', s.live.title), dialog, confirmed, stage, tag, list.element];
    if (v.source !== 'file') nodes.push(bar, el('p', 'vc-text vc-muted', s.live.barNote));
    nodes.push(stop);
    let germKey = '';
    return {
      key: `${v.source}|${v.sessionId ?? v.fileName ?? ''}`,
      nodes,
      update(now) {
        const diag: CaptureDiag | null = now.diag;
        const speakers = diag?.multiSpeaker ?? 'NONE';
        const ask = now.source !== 'file' && speakers === 'PENDING' && diag?.state !== 'FINALIZING';
        // Review L-1: an answer that got no effect within ANSWER_RETRY_MS can be given again.
        if (ask && (dialog.hidden || (yes.disabled && performance.now() - answeredAt > ANSWER_RETRY_MS))) {
          yes.disabled = false;
          no.disabled = false;
          if (dialog.hidden) announce.textContent = m.question;
        }
        dialog.hidden = !ask;
        // Review L-6: the confirmation is announced once, like the question.
        if (speakers === 'CONFIRMED' && confirmed.hidden) announce.textContent = m.confirmed;
        confirmed.hidden = speakers !== 'CONFIRMED';
        // The germ is redrawn only when the provisional seed changes.
        const seed = diag?.provisionalSeed ?? null;
        const nextKey = seed?.join(',') ?? '';
        if (nextKey !== germKey) {
          germKey = nextKey;
          const g = seed === null ? null : geometryOf(seed, GERM_CONFIDENCE);
          if (g !== null) showPlateFallback(stage, g, GERM_PX);
          else stage.replaceChildren(el('p', 'vc-text vc-muted', s.live.waiting));
          tag.hidden = g === null;
        }
        const state =
          now.source === 'file' || diag?.state === 'FINALIZING'
            ? s.live.states.finalizing
            : diag?.state === 'PAUSED'
              ? s.live.states.paused
              : diag === null || diag.state === 'AUTHORIZING'
                ? s.live.states.starting
                : s.live.states.collecting;
        const validMs = diag?.validSpeechMs ?? 0;
        const [first, second] = list.values;
        if (now.source === 'file') {
          if (first !== undefined) first.textContent = state;
        } else {
          if (first !== undefined) first.textContent = s.live.validSpeechOf((validMs / 1000).toFixed(1).replace('.', ','), String(max / 1000));
          if (second !== undefined) second.textContent = state;
          fill.style.width = `${String(Math.round(Math.min(1, validMs / max) * 100))}%`;
          bar.setAttribute('aria-valuenow', (validMs / 1000).toFixed(1));
        }
      },
    };
  };

  const revealedScreen = (r: RevealedResult): HTMLElement[] => {
    const resultKey = `${r.sessionId ?? r.fileName ?? ''}|${r.seed.join(',')}`;
    // I-13b: the profile (BACKLOG I-13 DoD, D-AN). The probe runs once per panel.
    gpu ??= probeGpu();
    const input: ProfileInput = { userSimplified: simplified, rendererName: gpu.rendererName, majorPerformanceCaveat: gpu.majorPerformanceCaveat, frameCostsMs: null };
    const base = chooseProfile(input);
    const choice: ProfileChoice = base.profile === 'vetrina' && slow ? { profile: 'economy', reason: 'SLOW_FRAMES' } : base;
    const key = `${resultKey}|${choice.profile}`;
    if (selected?.result !== resultKey) selected = null;
    if (showcase?.key !== key) {
      disposeShowcase();
      const stage = el('div', 'vc-stage vc-reveal');
      stage.dataset['testid'] = 'shell-showcase';
      stage.dataset['profile'] = choice.profile;
      stage.dataset['profileReason'] = choice.reason;
      const geometry = geometryOf(r.seed, r.quality.confidence);
      let handle: RenderHandle | null = null;
      if (geometry !== null) {
        stage.setAttribute('role', 'img');
        stage.setAttribute('aria-label', s.revealed.showcaseLabel(geometry.habitName));
        // renderCrystal falls back to the SVG plate by itself without WebGL
        // (SPEC §13); it throws only on a malformed geometry, which then shows
        // no crystal rather than breaking the screen (review L-1).
        try {
          handle = renderCrystal(geometry, {
            container: stage,
            profile: choice.profile,
            reducedMotion: reducedMotion(),
            sizePx: SHOWCASE_PX,
            // D-AN: the first frames of the vetrina decide, once, whether it stays.
            ...(choice.profile === 'vetrina'
              ? {
                  onFrameCosts: (costs: number[]) => {
                    if (chooseProfile({ ...input, frameCostsMs: costs }).reason !== 'SLOW_FRAMES') return;
                    slow = true;
                    queueMicrotask(() => {
                      if (view.screen === 'REVEALED') render();
                    });
                  },
                }
              : {}),
          });
        } catch {
          stage.replaceChildren();
        }
      }
      showcase = { key, stage, handle, geometry, choice };
    }
    const shown = showcase;
    const geometry = shown.geometry;
    const mic = r.source === 'mic';
    const provenance = r.source === 'tab' ? s.revealed.provenanceTab : mic ? s.revealed.provenanceMic : s.revealed.provenanceFile(r.fileName ?? '');
    const rows: [string, string][] = [
      [s.revealed.habit, geometry?.habitName ?? '—'],
      [s.revealed.provenance, provenance],
      [s.revealed.collected, new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })],
    ];
    if (r.exitReason !== null) rows.push([s.revealed.ending, exitText(r.exitReason, mic)]);
    // I-13b: quality warnings (review M-4 of I-13a) and veiled traits (ADR-0014) on the label.
    const warnings = labelWarnings(r.quality.warnings);
    if (warnings.length > 0) rows.push([s.revealed.warnings, warnings.join('; ')]);
    const veiled = geometry === null ? [] : veiledLines(geometry);
    if (veiled.length > 0) rows.push([s.revealed.veiled, veiled.join('; ')]);
    rows.push([s.revealed.extractor, r.extractorVersion ?? '—'], [s.revealed.seed, r.seed.join(' · ')]);
    const label = el('div', 'vc-label');
    label.dataset['testid'] = 'shell-label';
    label.append(el('h2', 'vc-label-name', s.revealed.name), el('p', 'vc-text vc-muted', s.revealed.nameNote), dataList(rows).element, el('p', 'vc-note', s.revealed.experimental));
    const actions = el('div', 'vc-btns');
    actions.append(
      button(s.revealed.discard, 'vc-btn vc-btn-ghost', 'shell-discard', () => {
        dispatch({ type: 'DISCARD' });
      }),
      button(s.revealed.exportSvg, 'vc-btn vc-btn-ghost', 'shell-export-svg', () => {
        if (geometry !== null) downloadPlate(geometry, r.seed);
      }),
    );
    const save = el('button', 'vc-btn', s.revealed.save);
    save.type = 'button';
    save.disabled = true;
    return [el('p', 'vc-cap', s.revealed.caption), shown.stage, legendSection(r, resultKey, shown), label, actions, save, profileSection(shown.choice, shown.handle?.state === 'webgl')];
  };

  /** I-13b: the live legend (SPEC §13, ADR-0028): rows select a trait, the showcase lights it up. */
  const legendSection = (r: RevealedResult, resultKey: string, shown: NonNullable<typeof showcase>): HTMLElement => {
    const l = s.legend;
    const section = el('section', 'vc-legend');
    section.dataset['testid'] = 'shell-legend';
    section.setAttribute('aria-label', l.title);
    section.append(el('h3', 'vc-legend-title', l.title));
    if (shown.handle?.state === 'webgl') section.append(el('p', 'vc-text vc-muted', l.hint));
    const rows = shown.geometry === null ? [] : legendRows(r.seed, r.rawMeasures, shown.geometry);
    const list = el('ul');
    const buttons: HTMLButtonElement[] = [];
    const apply = (): void => {
      const key = selected?.key ?? null;
      for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset['key'] === key));
      // The renderer states what it lit on the stage (data-highlight): nothing on the SVG plate.
      shown.handle?.highlight(rows.find((row) => row.key === key)?.highlight ?? null);
    };
    for (const row of rows) {
      const b = button('', 'vc-legend-row', 'legend-row', () => {
        selected = selected?.key === row.key ? null : { result: resultKey, key: row.key };
        apply();
      });
      b.dataset['key'] = row.key;
      b.append(el('span', 'vc-legend-trait', `${row.trait} · ${row.descriptor}`), el('span', '', `${row.measure} · ${row.percentile}`));
      const notes: string[] = [];
      if (row.veiled) notes.push(l.lowConfidence);
      if (row.nothing !== null) notes.push(row.nothing);
      else if (row.highlight === null) notes.push(l.wholeCrystal);
      if (notes.length > 0) b.append(el('span', 'vc-legend-sub', notes.join(' · ')));
      buttons.push(b);
      const li = el('li');
      li.append(b);
      list.append(li);
    }
    section.append(list, el('p', 'vc-note', l.note));
    apply();
    return section;
  };

  /** I-13b: «Resa semplificata», remembered across sessions; the profile in use and why. */
  const profileSection = (choice: ProfileChoice, webgl: boolean): HTMLElement => {
    const r = s.revealed;
    const box = el('div', 'vc-card');
    if (!webgl) {
      // Review M-3: the SVG plate stands in for the showcase (SPEC §13): no profile to choose.
      const used = el('p', 'vc-text vc-muted', `${r.profile}: ${r.noWebgl}`);
      used.dataset['testid'] = 'shell-profile';
      box.append(used);
      return box;
    }
    const label = el('label', 'vc-toggle');
    const input = el('input');
    input.type = 'checkbox';
    input.checked = simplified;
    input.dataset['testid'] = 'shell-simplified';
    input.addEventListener('change', () => {
      simplified = input.checked;
      // Stored only while chosen: with the option off nothing is kept (the file privacy E2E expects an empty local storage).
      void (simplified ? chrome.storage.local.set({ [RENDER_SIMPLIFIED_KEY]: true }) : chrome.storage.local.remove(RENDER_SIMPLIFIED_KEY)).catch(() => undefined);
      render();
      // The screen was rebuilt: keep the keyboard focus on the option.
      screen.querySelector<HTMLInputElement>('[data-testid="shell-simplified"]')?.focus();
    });
    label.append(input, el('span', '', r.simplified));
    const reason = r.profileReasons[choice.reason];
    const used = el('p', 'vc-text vc-muted', `${r.profile}: ${r.profiles[choice.profile]}${reason === '' ? '' : ` (${reason})`}`);
    used.dataset['testid'] = 'shell-profile';
    box.append(label, el('p', 'vc-text vc-muted', r.simplifiedNote), used);
    return box;
  };

  const outcomeScreen = (o: ViewOutcome): HTMLElement[] => {
    const mic = o.source === 'mic';
    const title = o.state === 'INSUFFICIENT_DATA' ? s.outcome.insufficient : o.state === 'INTERRUPTED' ? s.outcome.interrupted : s.outcome.error;
    // Review M-1/M-2: the source's own words (microphone texts of I-17, file refusals of I-18).
    const reason =
      o.message !== null
        ? o.message
        : o.code === 'FILE_DECODE_FAILED'
          ? s.outcome.fileError
          : o.code !== null
            ? errorText(o.code, mic)
            : o.exitReason !== null && o.exitReason !== 'QUALITY_REJECTED' && o.state !== 'INSUFFICIENT_DATA'
              ? exitText(o.exitReason, mic)
              : s.outcome.insufficientText;
    const out: HTMLElement[] = [el('p', 'vc-cap', s.outcome.caption), el('h2', 'vc-h2', title), el('p', 'vc-text', reason)];
    if (o.state === 'INSUFFICIENT_DATA') {
      const card = el('div', 'vc-card');
      card.append(el('p', 'vc-card-title', s.outcome.tryTitle), el('p', 'vc-text vc-muted', s.outcome.tryText));
      out.push(card);
    }
    out.push(
      button(s.outcome.back, 'vc-btn', 'shell-back', () => {
        dispatch({ type: 'DISMISS' });
      }),
    );
    return out;
  };

  function render(): void {
    if (view.screen !== 'REVEALED') disposeShowcase();
    if (view.screen !== 'LIVE') live = null;
    let title: string;
    let children: HTMLElement[];
    switch (view.screen) {
      case 'HOME':
        children = homeScreen();
        title = s.home.title;
        break;
      case 'LIVE': {
        const key = `${view.source}|${view.sessionId ?? view.fileName ?? ''}`;
        if (live?.key === key) {
          // Same session: update in place, nothing is rebuilt (review H-2).
          live.update(view);
          return;
        }
        live = buildLive(view);
        live.update(view);
        children = [...live.nodes];
        title = s.live.title;
        break;
      }
      case 'REVEALED':
        children = revealedScreen(view.result);
        title = s.revealed.caption;
        break;
      case 'OUTCOME':
        children = outcomeScreen(view.outcome);
        title = s.outcome.caption;
        break;
    }
    if (view.screen !== 'HOME') {
      // Controls and technical rows of the running views, folded away; the
      // same <details> element, so its open state is kept.
      tech.append(tools);
      children.push(tech);
    }
    screen.dataset['screen'] = view.screen;
    screen.replaceChildren(...children);
    if (title !== announced) {
      announced = title;
      announce.textContent = title;
    }
  }

  render();
}

/** «Esporta tavola SVG»: the canonical plate (ADR-0013), saved by the browser; nothing leaves the computer. */
function downloadPlate(geometry: CrystalGeometry, seed: CrystalSeed): void {
  const svg = renderPlateSvg(geometry, { ...DEFAULT_PLATE_VIEW, sizePx: 512 });
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `voicecrystal-${seed.join('-')}.svg`;
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1_000);
}
