import type { Store } from '../store';

/** Placeholder: replaced by plan 03-02. Draws only a background. */
export function mountBoard(canvas: HTMLCanvasElement, _store: Store): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const draw = () => {
    canvas.width = canvas.clientWidth || 800;
    canvas.height = canvas.clientHeight || 600;
    ctx.fillStyle = '#14110f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  };
  draw();
  window.addEventListener('resize', draw);
}
