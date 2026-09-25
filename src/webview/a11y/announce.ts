/**
 * Screen-reader announcements.
 *
 * There is NO VS Code API for this: `AccessibilityInformation` exists only on
 * TreeItem and StatusBarItem, nothing webview-facing. A self-managed live
 * region is the only option.
 */
let region: HTMLElement | null = null;

export function mountAnnouncer(parent: HTMLElement): void {
  region = document.createElement('div');
  region.id = 'announcer';
  region.className = 'visually-hidden';
  region.setAttribute('aria-live', 'polite');
  region.setAttribute('aria-atomic', 'true');
  parent.appendChild(region);
}

export function announce(text: string, assertive = false): void {
  if (!region) return;
  region.setAttribute('aria-live', assertive ? 'assertive' : 'polite');
  // Clear first, then set on the next frame, or an identical message is not
  // re-announced.
  region.textContent = '';
  requestAnimationFrame(() => {
    if (region) region.textContent = text;
  });
}
