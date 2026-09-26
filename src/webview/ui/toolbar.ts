/**
 * The floating toolbars.
 *
 * Modelled on Claude's canvas: a rounded pill of icon-only tools floating over
 * the board rather than a full-width bar clamped to the top, plus a separate
 * pill on the right for view controls. The board is the content; the chrome
 * should sit on top of it and take as little room as possible.
 *
 * Every control is still a real <button> with an accessible name, because
 * icon-only is exactly where that stops being optional.
 */

export interface ToolbarParts {
  bar: HTMLElement;
  viewbar: HTMLElement;
  boardBtn: HTMLButtonElement;
  tools: Record<'select' | 'hand' | 'pen' | 'note', HTMLButtonElement>;
  styleBtn: HTMLButtonElement;
  questionsBtn: HTMLButtonElement;
  panelBtn: HTMLButtonElement;
  zoomBtn: HTMLButtonElement;
  menu: HTMLElement;
}

const ICON = {
  cursor:
    '<path d="M4 2.5 15 9.2l-4.6 1.1a1 1 0 0 0-.7.6L8.2 15.3z" fill="currentColor"/>',
  hand:
    '<path d="M6 8.5V4.8a1.1 1.1 0 0 1 2.2 0v3.2m0 0V3.6a1.1 1.1 0 0 1 2.2 0v4.7m0 0V4.6a1.1 1.1 0 1 1 2.2 0v5.2m-6.6-1v4.4c0 2 1.6 3.4 3.6 3.4h.8c2 0 3.2-1.4 3.2-3.4V9.6m-8.8-.7L4.4 10a1.2 1.2 0 0 0-.2 1.6l1.3 1.8" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',
  pen:
    '<path d="M12.6 2.9a1.6 1.6 0 0 1 2.3 2.3l-8 8-3.1.8.8-3.1z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  note:
    '<path d="M3.5 3.5h11v7l-4 4h-7z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/><path d="M14.5 10.5h-4v4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>',
  style:
    '<rect x="2.6" y="2.6" width="5.6" height="5.6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><rect x="9.8" y="9.8" width="5.6" height="5.6" rx="1.4" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M9.8 5.4h5.6M5.4 9.8v5.6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>',
  question:
    '<circle cx="9" cy="9" r="6.3" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M7.2 7.1a1.9 1.9 0 1 1 2.5 1.8c-.5.2-.7.6-.7 1.1v.4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="9" cy="12.6" r=".85" fill="currentColor"/>',
  panel:
    '<rect x="2.6" y="3.4" width="12.8" height="11.2" rx="2" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M7 3.4v11.2" stroke="currentColor" stroke-width="1.3"/>',
  chevron: '<path d="M4.8 7 9 11.2 13.2 7" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>'
};

function svgIcon(d: string, size = 18): string {
  return `<svg viewBox="0 0 18 18" width="${size}" height="${size}" aria-hidden="true" focusable="false">${d}</svg>`;
}

function iconButton(icon: keyof typeof ICON, label: string, hint?: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tb-btn';
  b.innerHTML = svgIcon(ICON[icon]);
  b.setAttribute('aria-label', label);
  b.title = hint ? `${label} (${hint})` : label;
  return b;
}

function sep(): HTMLElement {
  const s = document.createElement('span');
  s.className = 'tb-sep';
  s.setAttribute('aria-hidden', 'true');
  return s;
}

export function buildToolbar(): ToolbarParts {
  const bar = document.createElement('div');
  bar.id = 'bar';
  bar.className = 'pill';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Board tools');

  // Left: the board itself — title, and the way into the library.
  const boardBtn = document.createElement('button');
  boardBtn.type = 'button';
  boardBtn.id = 'boardmenu';
  boardBtn.className = 'tb-label';
  boardBtn.setAttribute('aria-haspopup', 'menu');
  boardBtn.setAttribute('aria-expanded', 'false');
  boardBtn.innerHTML = `<span id="title">Claude Notes</span><span id="folder"></span>${svgIcon(ICON.chevron, 14)}`;

  const select = iconButton('cursor', 'Select', 'V');
  select.dataset.tool = 'select';
  // A dedicated pan tool, as on any canvas. Without one, every attempt to move
  // around a busy board grabs whatever is under the cursor instead.
  const hand = iconButton('hand', 'Pan the board', 'H, or hold Space');
  hand.dataset.tool = 'hand';
  const pen = iconButton('pen', 'Pen', 'P');
  pen.dataset.tool = 'pen';
  const note = iconButton('note', 'Sticky note', 'N');
  note.dataset.tool = 'note';
  for (const b of [select, hand, pen, note]) b.setAttribute('aria-pressed', 'false');
  select.setAttribute('aria-pressed', 'true');
  select.classList.add('active');

  const styleBtn = iconButton('style', 'Render style');
  styleBtn.id = 'stylebtn';
  styleBtn.setAttribute('aria-haspopup', 'menu');
  styleBtn.setAttribute('aria-expanded', 'false');

  const questionsBtn = iconButton('question', 'Questions from Claude');
  questionsBtn.id = 'qbtn';
  questionsBtn.setAttribute('aria-expanded', 'false');
  questionsBtn.setAttribute('aria-controls', 'qpanel');
  questionsBtn.hidden = true;

  bar.append(boardBtn, sep(), select, hand, pen, note, sep(), styleBtn, questionsBtn);

  // Right: view controls, mirroring the canvas layout.
  const viewbar = document.createElement('div');
  viewbar.id = 'viewbar';
  viewbar.className = 'pill';
  viewbar.setAttribute('role', 'toolbar');
  viewbar.setAttribute('aria-label', 'View');

  const panelBtn = iconButton('panel', 'Show board as text');
  panelBtn.id = 'panelbtn';
  panelBtn.setAttribute('aria-expanded', 'false');

  const zoomBtn = document.createElement('button');
  zoomBtn.type = 'button';
  zoomBtn.id = 'zoombtn';
  zoomBtn.className = 'tb-label zoom';
  zoomBtn.setAttribute('aria-haspopup', 'menu');
  zoomBtn.setAttribute('aria-expanded', 'false');
  zoomBtn.setAttribute('aria-label', 'Zoom');
  zoomBtn.innerHTML = `<span id="zoomval">100%</span>${svgIcon(ICON.chevron, 14)}`;

  viewbar.append(panelBtn, sep(), zoomBtn);

  // One popover, reused by each menu.
  const menu = document.createElement('div');
  menu.id = 'menu';
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  return {
    bar,
    viewbar,
    boardBtn,
    tools: { select, hand, pen, note },
    styleBtn,
    questionsBtn,
    panelBtn,
    zoomBtn,
    menu
  };
}

export interface MenuItem {
  label: string;
  hint?: string;
  checked?: boolean;
  run(): void;
}

/** Opens the shared popover under `anchor`. */
export function openMenu(menu: HTMLElement, anchor: HTMLElement, items: MenuItem[]): void {
  menu.replaceChildren();
  for (const it of items) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'menu-item';
    b.setAttribute('role', 'menuitemradio');
    b.setAttribute('aria-checked', String(it.checked === true));
    const tick = document.createElement('span');
    tick.className = 'menu-tick';
    tick.textContent = it.checked ? '✓' : '';
    tick.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.className = 'menu-label';
    label.textContent = it.label;
    b.append(tick, label);
    if (it.hint) {
      const k = document.createElement('kbd');
      k.textContent = it.hint;
      b.appendChild(k);
    }
    b.onclick = () => {
      closeMenu(menu);
      it.run();
    };
    menu.appendChild(b);
  }
  const r = anchor.getBoundingClientRect();
  menu.hidden = false;
  menu.style.left = `${Math.round(r.left)}px`;
  menu.style.top = `${Math.round(r.bottom + 6)}px`;
  anchor.setAttribute('aria-expanded', 'true');
  menu.dataset.anchor = anchor.id || '';
  (menu.querySelector('button') as HTMLElement | null)?.focus();
}

export function closeMenu(menu: HTMLElement): void {
  if (menu.hidden) return;
  menu.hidden = true;
  const id = menu.dataset.anchor;
  if (id) document.getElementById(id)?.setAttribute('aria-expanded', 'false');
}
