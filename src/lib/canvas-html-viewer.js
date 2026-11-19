// This script is embedded verbatim. It only navigates the exported document.
(() => {
  const viewport = document.getElementById('viewport');
  const world = document.getElementById('world');
  const reader = document.getElementById('reader');
  const content = reader.querySelector('.reading-content');
  const close = document.getElementById('close-reader');
  const zoomValue = document.getElementById('zoom-value');
  const box = world.dataset;
  let x = 0, y = 0, zoom = 1, fitted = true, minZoom = .05;
  let activeCard = null;

  function paint() {
    world.style.transform = `translate(${x}px,${y}px) scale(${zoom})`;
    world.style.setProperty('--heading-scale', Math.min(4, Math.max(1, .72 / zoom)));
    world.classList.toggle('overview', zoom < .55);
    zoomValue.value = `${Math.round(zoom * 1000) / 10}%`;
  }

  function fit() {
    if (!viewport.clientWidth || !viewport.clientHeight) return;
    const w = viewport.clientWidth, h = viewport.clientHeight;
    zoom = Math.min(1, Math.max(1, w - 48) / Number(box.width), Math.max(1, h - 144) / Number(box.height));
    minZoom = Math.min(.05, zoom);
    x = (w - Number(box.width) * zoom) / 2 - Number(box.x) * zoom;
    y = (h - Number(box.height) * zoom) / 2 - Number(box.y) * zoom;
    fitted = true;
    paint();
  }

  function zoomAt(factor, cx = viewport.clientWidth / 2, cy = viewport.clientHeight / 2) {
    const next = Math.max(minZoom, Math.min(4, zoom * factor));
    x = cx - (cx - x) * next / zoom;
    y = cy - (cy - y) * next / zoom;
    zoom = next;
    fitted = false;
    paint();
  }

  document.getElementById('zoom-in').addEventListener('click', () => zoomAt(1.35));
  document.getElementById('zoom-out').addEventListener('click', () => zoomAt(1 / 1.35));
  document.getElementById('fit-view').addEventListener('click', fit);
  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    const rect = viewport.getBoundingClientRect();
    zoomAt(2 ** (-event.deltaY * unit * .002), event.clientX - rect.left, event.clientY - rect.top);
  }, { passive: false });

  // A click opens a card, while a drag anywhere on the surface moves only the viewport.
  const pointers = new Map();
  let moved = false;
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0 && event.button !== 1) return;
    if (!pointers.size) moved = false;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size > 1) moved = true;
    event.target.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener('pointermove', event => {
    const old = pointers.get(event.pointerId);
    if (!old) return;
    const dx = event.clientX - old.x, dy = event.clientY - old.y;
    if (!moved && Math.hypot(dx, dy) < 4) return;
    moved = true;
    fitted = false;
    viewport.classList.add('panning');
    const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
    if (other) {
      const distance = Math.hypot(old.x - other.x, old.y - other.y);
      const next = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      const rect = viewport.getBoundingClientRect();
      if (distance > 0 && next > 0) zoomAt(next / distance, (old.x + other.x) / 2 - rect.left, (old.y + other.y) / 2 - rect.top);
    }
    x += other ? dx / 2 : dx;
    y += other ? dy / 2 : dy;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    paint();
  });
  function release(event) {
    pointers.delete(event.pointerId);
    if (!pointers.size) viewport.classList.remove('panning');
  }
  viewport.addEventListener('lostpointercapture', release);
  viewport.addEventListener('pointerup', release);
  viewport.addEventListener('pointercancel', release);

  viewport.addEventListener('click', event => {
    const card = event.target.closest('.canvas-node');
    if (!card || (event.detail && moved)) return;
    activeCard?.setAttribute('aria-expanded', 'false');
    activeCard = card;
    card.setAttribute('aria-expanded', 'true');
    document.getElementById('reader-title').textContent = card.getAttribute('aria-label');
    content.replaceChildren(document.getElementById(card.dataset.reader).content.cloneNode(true));
    reader.hidden = false;
    content.scrollTop = 0;
    close.focus({ preventScroll: true });
  });
  function closeReader() {
    reader.hidden = true;
    content.replaceChildren();
    activeCard?.setAttribute('aria-expanded', 'false');
    activeCard?.focus({ preventScroll: true });
    activeCard = null;
  }
  close.addEventListener('click', closeReader);
  document.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape' && !reader.hidden) closeReader();
  });
  viewport.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229 || event.ctrlKey || event.metaKey || event.altKey) return;
    const step = 80;
    switch (event.key) {
      case '+': case '=': zoomAt(1.35); break;
      case '-': zoomAt(1 / 1.35); break;
      case 'Home': fit(); break;
      case 'ArrowLeft': x += step; break;
      case 'ArrowRight': x -= step; break;
      case 'ArrowUp': y += step; break;
      case 'ArrowDown': y -= step; break;
      default: return;
    }
    event.preventDefault();
    if (event.key.startsWith('Arrow')) { fitted = false; paint(); }
  });
  viewport.addEventListener('focusin', event => {
    if (!event.target.matches('.canvas-node:focus-visible')) return;
    const card = event.target.getBoundingClientRect(), view = viewport.getBoundingClientRect();
    if (card.right > view.left && card.left < view.right && card.bottom > view.top && card.top < view.bottom) return;
    x += (view.left + view.right - card.left - card.right) / 2;
    y += (view.top + view.bottom - card.top - card.bottom) / 2;
    fitted = false;
    paint();
  });
  new ResizeObserver(() => { if (fitted) fit(); }).observe(viewport);
  fit();
})();
