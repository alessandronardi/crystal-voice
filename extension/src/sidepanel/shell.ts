// The side panel screens of I-13a (SPEC §13, view machine of §6.2):
// home, listening as nucleation, revelation with the label, outcome. Style
// «Gabinetto di mineralogia» (D-AJ). The I-02…I-07 views (capture-view,
// file-view) keep their controls and technical rows: on the home screen they
// are the «La tua voce» card, on the other screens they move into «Dettagli
// tecnici». Text goes through textContent only (R17); the plate SVG is our
// own, parsed by renderer-three's fallback, never innerHTML.
import { DEFAULT_PLATE_VIEW, GEOMETRY_VERSIONS, type CaptureDiag, type CrystalGeometry, type CrystalSeed, type SeedConfidence } from '@voicecrystal/contracts';
import { generateCrystalGeometry } from '@voicecrystal/crystal-core';
import { renderPlateSvg } from '@voicecrystal/renderer-svg';
import { renderCrystal, showPlateFallback, type RenderHandle } from '@voicecrystal/renderer-three';
import { CAPTURE_LIMITS } from '../offscreen/capture-machine.ts';
import { strings } from '../ui/strings.it.ts';
import { errorText, exitText, mountCaptureView } from './capture-view.ts';
import { mountFileView } from './file-view.ts';
import { INITIAL_VIEW, viewTransition, type RevealedResult, type ViewEvent, type ViewOutcome, type ViewState } from './view-machine.ts';

const s = strings.shell;
/** The geometry of habit-1, the one version today (review L-2). */
const GEOMETRY_VERSION = GEOMETRY_VERSIONS[0];
/** The germ is drawn without veils: it is a sketch of the current estimates, not a result (review L-3). */
const GERM_CONFIDENCE: SeedConfidence = [1, 1, 1, 1, 1, 1];
/** [H] Showcase and germ sizes in CSS pixels, for a side panel about 360 px wide. */
const SHOWCASE_PX = 300;
const GERM_PX = 180;

/** The licence texts copied into the package (extension/scripts/build.ts), G0-DOC-01. */
const LICENSES: readonly { label: string; href: string }[] = [
  { label: 'three.js (MIT)', href: 'THIRD_PARTY/three/LICENSE.txt' },
  { label: 'libfvad (BSD-3-Clause)', href: 'THIRD_PARTY/libfvad/LICENSE.txt' },
  { label: 'WebRTC PATENTS', href: 'THIRD_PARTY/libfvad/PATENTS.txt' },
  { label: 'Emscripten (MIT / NCSA)', href: 'THIRD_PARTY/emscripten/emscripten-LICENSE.txt' },
  { label: 'musl (MIT)', href: 'THIRD_PARTY/emscripten/musl-COPYRIGHT.txt' },
  { label: 'compiler-rt (Apache-2.0 con eccezione LLVM)', href: 'THIRD_PARTY/emscripten/compiler-rt-LICENSE.txt' },
  { label: 'dlmalloc (pubblico dominio)', href: 'THIRD_PARTY/emscripten/dlmalloc-NOTICE.txt' },
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
  let showcase: { key: string; stage: HTMLElement; handle: RenderHandle | null; geometry: CrystalGeometry | null } | null = null;
  let live: LiveView | null = null;
  let announced = '';

  const dispatch = (event: ViewEvent): void => {
    const next = viewTransition(view, event);
    if (next === view) return;
    view = next;
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
    const nodes: HTMLElement[] = [el('p', 'vc-cap', s.live.caption(caption)), el('h2', 'vc-h2', s.live.title), stage, tag, list.element];
    if (v.source !== 'file') nodes.push(bar, el('p', 'vc-text vc-muted', s.live.barNote));
    nodes.push(stop);
    let germKey = '';
    return {
      key: `${v.source}|${v.sessionId ?? v.fileName ?? ''}`,
      nodes,
      update(now) {
        const diag: CaptureDiag | null = now.diag;
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
    const key = `${r.sessionId ?? r.fileName ?? ''}|${r.seed.join(',')}`;
    if (showcase?.key !== key) {
      disposeShowcase();
      const stage = el('div', 'vc-stage vc-reveal');
      stage.dataset['testid'] = 'shell-showcase';
      const geometry = geometryOf(r.seed, r.quality.confidence);
      let handle: RenderHandle | null = null;
      if (geometry !== null) {
        stage.setAttribute('role', 'img');
        stage.setAttribute('aria-label', s.revealed.showcaseLabel(geometry.habitName));
        // renderCrystal falls back to the SVG plate by itself without WebGL
        // (SPEC §13); it throws only on a malformed geometry, which then shows
        // no crystal rather than breaking the screen (review L-1).
        try {
          handle = renderCrystal(geometry, { container: stage, profile: 'vetrina', reducedMotion: reducedMotion(), sizePx: SHOWCASE_PX });
        } catch {
          stage.replaceChildren();
        }
      }
      showcase = { key, stage, handle, geometry };
    }
    const geometry = showcase.geometry;
    const mic = r.source === 'mic';
    const provenance = r.source === 'tab' ? s.revealed.provenanceTab : mic ? s.revealed.provenanceMic : s.revealed.provenanceFile(r.fileName ?? '');
    const rows: [string, string][] = [
      [s.revealed.habit, geometry?.habitName ?? '—'],
      [s.revealed.provenance, provenance],
      [s.revealed.collected, new Date().toLocaleDateString('it-IT', { day: 'numeric', month: 'short', year: 'numeric' })],
    ];
    if (r.exitReason !== null) rows.push([s.revealed.ending, exitText(r.exitReason, mic)]);
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
    return [el('p', 'vc-cap', s.revealed.caption), showcase.stage, label, actions, save];
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
