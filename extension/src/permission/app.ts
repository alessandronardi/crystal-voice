// Permission page (SPEC §5 component 5; ADR-0009; I-17). Opened in a tab by
// the side panel: a visible extension page is where the browser can show the
// microphone prompt, which the side panel and the offscreen document cannot.
// The grant belongs to the extension's origin; the offscreen then opens the
// microphone itself. The stream obtained here is stopped at once: no audio is
// kept, played or analysed (AGENTS.md R1). Text through textContent (R17).
import { strings } from '../ui/strings.it.ts';

const t = strings.permission;
const page = strings.pages.permission;

type Outcome = 'idle' | 'asking' | 'granted' | 'denied' | 'unavailable';

const PERMISSION_ERRORS: readonly string[] = ['NotAllowedError', 'SecurityError', 'PermissionDeniedError'];

function mount(root: HTMLElement): void {
  const heading = document.createElement('h1');
  heading.className = 'text-lg font-semibold';
  heading.textContent = page.heading;
  const intro = document.createElement('p');
  intro.className = 'mt-2 max-w-prose text-sm text-slate-700';
  intro.textContent = t.intro;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'mt-4 rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50';
  button.dataset['testid'] = 'permission-allow';
  button.textContent = t.allow;
  const status = document.createElement('p');
  status.className = 'mt-3 max-w-prose text-sm';
  status.dataset['testid'] = 'permission-status';
  status.setAttribute('role', 'status');
  root.replaceChildren(heading, intro, button, status);

  const show = (outcome: Outcome): void => {
    status.dataset['outcome'] = outcome;
    status.textContent = outcome === 'idle' ? '' : t[outcome];
    // Pressing it again after a grant only re-checks the microphone: harmless.
    button.disabled = outcome === 'asking';
  };

  button.addEventListener('click', () => {
    show('asking');
    navigator.mediaDevices
      .getUserMedia({ audio: true, video: false })
      .then((stream) => {
        // Only the grant is wanted: release the microphone immediately.
        for (const track of stream.getTracks()) track.stop();
        show('granted');
      })
      .catch((error: unknown) => {
        const name = error instanceof DOMException || error instanceof Error ? error.name : '';
        show(PERMISSION_ERRORS.includes(name) ? 'denied' : 'unavailable');
      });
  });

  // Reflect a grant or refusal made earlier, or from the site settings while open.
  void navigator.permissions
    .query({ name: 'microphone' })
    .then((permission) => {
      const sync = (): void => {
        if (permission.state === 'granted') show('granted');
        else if (permission.state === 'denied') show('denied');
        else show('idle');
      };
      sync();
      permission.addEventListener('change', sync);
    })
    .catch(() => {
      show('idle');
    });
}

document.title = page.title;
const root = document.getElementById('app');
if (root !== null) mount(root);
