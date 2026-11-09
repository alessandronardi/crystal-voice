// Non-conforming on purpose: R17 must survive the geometry block's rule override.
export function render(el: { innerHTML: string }, s: string): void {
  el.innerHTML = s; // ✗
}
