// No app bundle or store is loaded. Only camera and document reading actions
// are attached to the original controls in the exported DOM.
(() => {
  const flow = document.querySelector('.react-flow[data-export-camera]');
  const world = flow.querySelector('.react-flow__viewport');
  const initial = JSON.parse(flow.dataset.exportCamera);
  const canvasArea = flow.parentElement;
  const panelHost = canvasArea.parentElement;
  let { x, y, zoom } = initial;
  const panels = new Map([...document.querySelectorAll('template[data-reading-node]')].map(el => [el.dataset.readingNode, el]));
  const readActions = '[data-open-export-reader],[data-document-open],[data-node-details],[data-overview-ruler-mark],[data-material-reader-close],[data-reader-expand],[data-reader-dock],[data-reader-strip-expand],[data-node-details-close]';
  const svg = flow.querySelector('.react-flow__minimap-svg');
  const patterns = [...flow.querySelectorAll('.react-flow__background pattern')].map(el => ({
    el, gap: Number(el.getAttribute('width')) / zoom, circle: el.querySelector('circle'), path: el.querySelector('path'),
    radius: Number(el.querySelector('circle')?.getAttribute('r')) / zoom,
  }));
  const boxes = [...world.querySelectorAll('.react-flow__node[data-id]')].map(el => {
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.e, y: m.f, width: el.offsetWidth, height: el.offsetHeight };
  });
  const left = Math.min(...boxes.map(b => b.x)), top = Math.min(...boxes.map(b => b.y));
  const right = Math.max(...boxes.map(b => b.x + b.width)), bottom = Math.max(...boxes.map(b => b.y + b.height));
  let trigger, opened, detailTrigger, moved = false;
  let panEnabled = flow.querySelector('.react-flow__controls-pan')?.getAttribute('aria-pressed') === 'true';
  let readingId = flow.dataset.openReader;
  let readerMode = flow.dataset.readerMode;
  const dockFits = () => window.innerWidth / (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1) >= Number(flow.dataset.dockMinWidth);
  const scrollPosition = scope => {
    for (const el of scope.querySelectorAll('[data-export-scroll-top],[data-export-scroll-left]')) {
      el.scrollTop = Number(el.dataset.exportScrollTop) || 0;
      el.scrollLeft = Number(el.dataset.exportScrollLeft) || 0;
    }
  };
  scrollPosition(document);
  for (const el of world.querySelectorAll('.react-flow__node[data-id]')) {
    if (panels.has(el.dataset.id)) el.tabIndex = 0;
  }
  function paint() {
    flow.dataset.exportNavigated = '';
    flow.style.setProperty('--export-camera-x', x + 'px');
    flow.style.setProperty('--export-camera-y', y + 'px');
    flow.style.setProperty('--export-camera-zoom', zoom);
    flow.style.setProperty('--tdag-zoom', zoom);
    for (const { el, gap, circle, path, radius } of patterns) {
      const step = gap * zoom;
      el.setAttribute('width', step); el.setAttribute('height', step);
      el.setAttribute('x', x % step); el.setAttribute('y', y % step);
      el.setAttribute('patternTransform', `translate(${-1 - step / 2},${-1 - step / 2})`);
      if (circle) for (const key of ['cx','cy','r']) circle.setAttribute(key, radius * zoom);
      if (path) path.setAttribute('d', `M${step / 2} 0 V${step} M0 ${step / 2} H${step}`);
    }
    updateMinimap();
  }
  function updateMinimap() {
    if (!svg || !boxes.length) return;
    const vx = -x / zoom, vy = -y / zoom, vw = flow.clientWidth / zoom, vh = flow.clientHeight / zoom;
    const bx = Math.min(left, vx), by = Math.min(top, vy);
    const bw = Math.max(right, vx + vw) - bx, bh = Math.max(bottom, vy + vh) - by;
    const w = svg.width.baseVal.value, h = svg.height.baseVal.value;
    if (!w || !h) return;
    const scale = Math.max(bw / w, bh / h);
    const uiScale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const pad = 5 * uiScale * scale;
    const mw = w * scale + 2 * pad, mh = h * scale + 2 * pad;
    const mx = bx - (mw - bw) / 2, my = by - (mh - bh) / 2;
    svg.setAttribute('viewBox', [mx,my,mw,mh].join(' '));
    svg.closest('.react-flow__minimap')?.style.setProperty('--xy-minimap-mask-stroke-width-props', String(uiScale * scale));
    svg.querySelector('.react-flow__minimap-mask')?.setAttribute('d', `M${mx - pad},${my - pad}h${mw + 2 * pad}v${mh + 2 * pad}h${-mw - 2 * pad}z M${vx},${vy}h${vw}v${vh}h${-vw}z`);
  }
  let flowWidth = flow.clientWidth, flowHeight = flow.clientHeight;
  new ResizeObserver(() => {
    if (flow.clientWidth === flowWidth && flow.clientHeight === flowHeight) return;
    flowWidth = flow.clientWidth; flowHeight = flow.clientHeight;
    updateMinimap();
  }).observe(flow);
  function zoomAt(factor, cx = flow.clientWidth / 2, cy = flow.clientHeight / 2) {
    const next = Math.max(.04, Math.min(2, zoom * factor));
    x = cx - (cx - x) * next / zoom; y = cy - (cy - y) * next / zoom;
    zoom = next; paint();
  }
  function fit() {
    if (!boxes.length) return;
    zoom = Math.max(.04, Math.min(2, flow.clientWidth / ((right - left || 1) * 1.2), flow.clientHeight / ((bottom - top || 1) * 1.2)));
    x = (flow.clientWidth - (right + left) * zoom) / 2;
    y = (flow.clientHeight - (bottom + top) * zoom) / 2;
    paint();
  }
  function localPoint(event) {
    const r = flow.getBoundingClientRect();
    return [(event.clientX - r.left) * flow.clientWidth / r.width, (event.clientY - r.top) * flow.clientHeight / r.height];
  }
  flow.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey && event.target.closest('.nowheel,.react-flow__panel')) return;
    event.preventDefault();
    if (flow.hasAttribute('data-wheel-pans') && !event.ctrlKey && !event.metaKey) {
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? flow.clientHeight : 1;
      x -= event.deltaX * unit; y -= event.deltaY * unit; paint(); return;
    }
    zoomAt(2 ** (-event.deltaY * (event.deltaMode === 1 ? .03 : .002)), ...localPoint(event));
  }, { passive: false });
  const pointers = new Map();
  flow.addEventListener('pointerdown', event => {
    if (event.button < 0 || event.button > 2) return;
    moved = false;
    if (event.button === 0 && ((!panEnabled && event.pointerType !== 'touch') || event.target.closest('button,a,summary,[role="button"],.react-flow__panel,.nopan,.nowheel'))) return;
    pointers.set(event.pointerId, localPoint(event));
    event.target.setPointerCapture(event.pointerId);
  });
  flow.addEventListener('contextmenu', event => { if (moved) event.preventDefault(); });
  flow.addEventListener('pointermove', event => {
    const old = pointers.get(event.pointerId);
    if (!old) return;
    const at = localPoint(event), dx = at[0] - old[0], dy = at[1] - old[1];
    if (!moved && Math.hypot(dx,dy) < 3) return;
    const other = [...pointers].find(([id]) => id !== event.pointerId)?.[1];
    if (other) {
      const prev = Math.hypot(old[0] - other[0], old[1] - other[1]);
      if (prev > 0) zoomAt(Math.hypot(at[0] - other[0], at[1] - other[1]) / prev, (old[0] + other[0]) / 2, (old[1] + other[1]) / 2);
    }
    moved = true; x += other ? dx / 2 : dx; y += other ? dy / 2 : dy;
    pointers.set(event.pointerId, at); paint();
  });
  for (const event of ['pointerup','pointercancel','lostpointercapture']) flow.addEventListener(event, e => pointers.delete(e.pointerId));
  function closeReader() {
    const panel = opened ?? document.querySelector('[data-material-reader]');
    if (!panel) return false;
    if (panel.hasAttribute('data-reader-docked') || panel.hasAttribute('data-reader-strip')) canvasArea.style.left = '0px';
    panel.remove(); opened = null; readingId = null; trigger?.focus({ preventScroll: true }); return true;
  }
  function read(card, action) {
    const template = panels.get(card?.dataset.id);
    if (!template) return;
    closeReader();
    trigger = action ?? card;
    readingId = card.dataset.id;
    opened = template.content.firstElementChild.cloneNode(true);
    const dock = readerMode === 'dock' && dockFits()
      && document.querySelector(`template[data-reading-dock="${CSS.escape(readingId)}"]`);
    if (dock) {
      const sheet = dock.content.firstElementChild.cloneNode(true);
      sheet.querySelector('[data-export-reading-body]').replaceWith(opened.querySelector('[data-export-reading-body]'));
      opened = sheet;
      canvasArea.style.left = opened.style.width;
    }
    opened.setAttribute('data-offline-reader', '');
    panelHost.append(opened);
    const close = opened.querySelector('[data-material-reader-close]');
    close?.focus({ preventScroll: true });
    const markId = action?.dataset.overviewRulerMark;
    if (markId) {
      const i = JSON.parse(template.dataset.markIds).indexOf(markId);
      const anchor = opened.querySelector(`[data-ruler-target="${i}"]`);
      for (let parent = anchor?.parentElement; parent && parent !== opened; parent = parent.parentElement) {
        if (parent.tagName === 'DETAILS') parent.open = true;
      }
      anchor?.scrollIntoView({ block: 'center' });
    } else if (action?.dataset.exportPage || action?.dataset.documentOpen) {
      const att = action.dataset.documentOpen;
      const section = (att && opened.querySelector(`[data-reading-file="${CSS.escape(att)}"]`)) || opened.querySelector('[data-export-reading-body]');
      const index = Math.max(0, Number(action.dataset.exportPage || 1) - 1);
      const page = section?.querySelectorAll('.pdf-document-page-wrap, .document-page')[index];
      (page || section)?.scrollIntoView({ block: 'nearest' });
    }
  }
  function switchReaderLayout() {
    if (!readingId) return;
    const scroll = document.querySelector('[data-material-reader] [data-reader-body]')?.scrollTop;
    read(world.querySelector(`[data-id="${CSS.escape(readingId)}"]`), trigger);
    const body = opened?.querySelector('[data-reader-body]');
    if (body && scroll) body.scrollTop = scroll;
  }
  window.addEventListener('resize', () => {
    const panel = document.querySelector('[data-material-reader]');
    if (readerMode === 'dock' && readingId && panel && dockFits() !== panel.matches('[data-reader-docked],[data-reader-strip]')) switchReaderLayout();
  });
  document.addEventListener('submit', e => e.preventDefault());
  function closeDetails() {
    const panel = document.querySelector('[data-focus-panel]');
    if (!panel) return;
    panel.remove();
    document.querySelector('[data-canvas-header]')?.style.removeProperty('right');
    detailTrigger?.focus({ preventScroll: true });
  }
  const frameTrigger = document.querySelector('[data-frame-nav-trigger]');
  function closeFrames(restoreFocus) {
    const menu = document.querySelector('[data-frame-nav-panel]');
    if (!menu) return false;
    menu.remove(); frameTrigger?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) frameTrigger?.focus({ preventScroll: true });
    return true;
  }
  function openFrames() {
    if (closeFrames(true)) return;
    const panel = document.querySelector('template[data-offline-frame-menu]')?.content.firstElementChild.cloneNode(true);
    if (!panel || !frameTrigger) return;
    const header = frameTrigger.closest('[data-canvas-header]').getBoundingClientRect();
    const scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ui-scale')) || 1;
    const inset = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--spacing-canvas-inset')) || 16;
    panel.style.top = header.bottom / scale + inset + 'px';
    panel.style.right = Math.max(inset, (window.innerWidth - header.right) / scale) + 'px';
    panel.style.maxWidth = 'calc(100 * var(--ui-vw) - 32px)';
    frameTrigger.parentElement.append(panel); frameTrigger.setAttribute('aria-expanded', 'true');
    panel.focus({ preventScroll: true });
  }
  document.addEventListener('click', e => {
    const el = e.target;
    if (!(el instanceof Element)) return;
    if (el.closest('[data-frame-nav-trigger]')) return openFrames();
    const frame = el.closest('[data-frame-nav-id]');
    if (frame) {
      const node = world.querySelector(`.react-flow__node[data-id="${CSS.escape(frame.dataset.frameNavId)}"]`);
      closeFrames(true);
      if (node) {
        const m = new DOMMatrixReadOnly(getComputedStyle(node).transform);
        zoom = Math.max(.04, Math.min(2, flow.clientWidth / (node.offsetWidth * 1.15), flow.clientHeight / (node.offsetHeight * 1.15)));
        x = flow.clientWidth / 2 - (m.e + node.offsetWidth / 2) * zoom;
        y = flow.clientHeight / 2 - (m.f + node.offsetHeight / 2) * zoom; paint();
      }
      return;
    }
    if (!el.closest('[data-frame-nav-panel]')) closeFrames(false);
    const disclosure = el.closest('[data-highlight-disclosure]');
    if (disclosure) {
      const list = disclosure.closest('[data-node-highlights]')?.querySelector('[data-highlight-list]');
      if (list) {
        list.hidden = !list.hidden;
        disclosure.setAttribute('aria-expanded', String(!list.hidden));
        const icon = disclosure.querySelector('svg');
        if (icon) icon.style.transform = icon.classList.contains('lucide-chevron-down') ? (list.hidden ? 'rotate(-90deg)' : '') : (list.hidden ? '' : 'rotate(90deg)');
      }
      return;
    }
    const imageToolbar = el.closest('[data-image-zoom]');
    if (imageToolbar) {
      const value = imageToolbar.querySelector('[data-zoom-fit]');
      const previous = parseFloat(value.textContent) / 100 || 1;
      const next = el.closest('[data-zoom-in]') ? Math.min(3, previous + .25) : el.closest('[data-zoom-out]') ? Math.max(.5, previous - .25) : 1;
      for (const figure of imageToolbar.closest('[data-reader-body]').querySelectorAll('[data-reader-image]')) {
        figure.style.width = Math.round(parseFloat(figure.style.width) / previous * next) + 'px';
        figure.style.maxWidth = next <= 1 ? '100%' : '';
      }
      value.textContent = Math.round(next * 100) + '%'; return;
    }
    const annotation = el.closest('[data-pdf-comment-pin],[data-pdf-annotation]');
    if (annotation) {
      const id = annotation.dataset.pdfCommentPin ?? annotation.dataset.pdfAnnotation;
      const selector = `[data-reading-pdf-note="${CSS.escape(id)}"]`;
      let note = annotation.closest('figure')?.querySelector(selector);
      if (!note) {
        const card = annotation.closest('.react-flow__node[data-id]') ?? (readingId && world.querySelector(`.react-flow__node[data-id="${CSS.escape(readingId)}"]`));
        if (card) read(card, annotation);
        note = opened?.querySelector(selector);
      }
      note?.scrollIntoView({ block: 'center' }); return;
    }
    if (el.closest('.react-flow__controls-zoomin')) return zoomAt(1.2);
    if (el.closest('.react-flow__controls-zoomout')) return zoomAt(1/1.2);
    if (el.closest('.react-flow__controls-fitview')) return fit();
    const pan = el.closest('.react-flow__controls-pan');
    if (pan) { panEnabled = !panEnabled; pan.setAttribute('aria-pressed', String(panEnabled)); return; }
    if (el.closest('[data-material-reader-close]') || el === opened) return closeReader();
    if (el.closest('[data-reader-strip-expand]') && readingId) {
      closeDetails(); readerMode = 'dock'; switchReaderLayout(); return;
    }
    if (el.closest('[data-reader-expand],[data-reader-dock]') && readingId) {
      readerMode = el.closest('[data-reader-expand]') ? 'full' : 'dock';
      switchReaderLayout(); return;
    }
    if (el.closest('[data-node-details-close]')) return closeDetails();
    const details = el.closest('[data-node-details]');
    if (details) {
      const id = details.dataset.nodeDetails;
      const panel = document.querySelector('[data-focus-panel]');
      const active = panel?.dataset.focusNodeId === id;
      closeDetails();
      const template = document.querySelector(`template[data-reading-details="${CSS.escape(id)}"]`);
      if (active || !template) return;
      detailTrigger = details;
      const copy = template.content.firstElementChild.cloneNode(true);
      panelHost.append(copy);
      const header = document.querySelector('[data-canvas-header]');
      if (header) header.style.right = `calc(min(${copy.style.width}, 70 * var(--ui-vw)) + 24px)`;
      copy.querySelector('[data-node-details-close]')?.focus({ preventScroll: true }); return;
    }
    if (el.closest('.react-flow__minimap-svg') && svg) {
      const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
      x = flow.clientWidth / 2 - pt.x * zoom; y = flow.clientHeight / 2 - pt.y * zoom; paint(); return;
    }
    if (e.detail && moved) return;
    const action = el.closest(readActions);
    const linked = action?.dataset.openExportReader;
    const card = (linked && world.querySelector(`.react-flow__node[data-id="${CSS.escape(linked)}"]`)) || el.closest('.react-flow__node[data-id]');
    if (action && card) read(card, action);
    else if (card && !el.closest('button,a,summary,[role="button"],input,textarea,select') && window.getSelection()?.isCollapsed) read(card);
    else if (el.closest('[aria-disabled="true"],a:not([href])')) e.preventDefault();
  });
  document.addEventListener('keydown', e => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') { if (!closeFrames(true) && !closeReader()) closeDetails(); return; }
    const el = e.target;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (el.matches('.react-flow__node[data-id],[data-overview-ruler-mark]')) { e.preventDefault(); el.click(); }
  });
})();
