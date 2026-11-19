const paths = {
  tab: 'M3 5h18v14H3z M3 9h18',
  mic: 'M9 5a3 3 0 0 1 6 0v6a3 3 0 0 1-6 0z M6 10v1a6 6 0 0 0 12 0v-1 M12 17v4 M9 21h6',
  file: 'M8 3h10v14l-4 4H6V5z',
  collection: 'M3 3h18v18H3z M9 3v18 M15 3v18 M3 9h18 M3 15h18',
} as const;

export function homeIcon(name: keyof typeof paths): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '24');
  svg.setAttribute('height', '24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', paths[name]);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '1.4');
  path.setAttribute('stroke-linejoin', 'round');
  path.setAttribute('stroke-linecap', 'round');
  svg.append(path);
  return svg;
}
