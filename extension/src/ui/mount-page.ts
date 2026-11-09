import { strings, type PageKey } from './strings.it.ts';

/** Fills a placeholder page. Text goes through textContent only (AGENTS.md R17). */
export function mountPage(key: PageKey): void {
  const page = strings.pages[key];
  document.title = page.title;
  const root = document.getElementById('app');
  if (root === null) return;
  const heading = document.createElement('h1');
  heading.className = 'text-lg font-semibold';
  heading.textContent = page.heading;
  const body = document.createElement('p');
  body.className = 'text-sm text-slate-600';
  body.textContent = strings.placeholder;
  root.replaceChildren(heading, body);
}
