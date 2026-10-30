const STORAGE_KEY = 'ssheet.mobileNoticeDismissed';
/** A small screen with nothing but a finger to point with: the editor won't be much use there. */
const MOBILE_QUERY = '(max-width: 900px) and (pointer: coarse)';

export interface NoticeLink {
  label: string;
  href: string;
  style: string;
}

function dismissed(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function remember(): void {
  try {
    localStorage.setItem(STORAGE_KEY, '1');
  } catch {
    // private mode etc.: the notice just shows again next time
  }
}

/**
 * On phones, covers the page with a card saying the editor is built for desktop.
 * "Continue anyway" removes it for good; the stacked layout below 900px is what they get.
 */
export function showDesktopNotice(links: NoticeLink[]): void {
  if (dismissed() || !window.matchMedia(MOBILE_QUERY).matches) return;

  const overlay = document.createElement('div');
  overlay.className = 'desktopNotice';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'desktopNoticeTitle');
  overlay.innerHTML = `
    <div class="card">
      <h1 id="desktopNoticeTitle">ssheet is built for desktop</h1>
      <p>It needs a mouse, a keyboard and a wide screen to edit units and export sprite sheets.
        Open this link on a computer to get going.</p>
      <button type="button" class="continue">Continue anyway</button>
      <div class="links"></div>
    </div>`;
  const linkRow = overlay.querySelector('.links')!;
  for (const { label, href, style } of links) {
    const a = document.createElement('a');
    a.className = style;
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    a.textContent = label;
    linkRow.append(a);
  }
  overlay.querySelector('.continue')!.addEventListener('click', () => {
    remember();
    overlay.remove();
  });
  document.body.append(overlay);
}
