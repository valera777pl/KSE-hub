/*
 * The splash lives in index.html and paints with the first frame, before any JS (no black screen).
 * The app takes it down once its first real screen is on the page: a 220 ms fade, no flash.
 */
let gone = false;

export function hideSplash() {
  if (gone) return;
  gone = true;
  const el = document.getElementById('splash');
  if (!el) return;
  let done = false;
  const out = () => {
    if (done) return;
    done = true;
    el.classList.add('splash--out');
    setTimeout(() => el.remove(), 260);
  };
  // Next frame: the screen underneath has painted. A hidden web view may never give a frame, hence the timer
  requestAnimationFrame(out);
  setTimeout(out, 120);
}
