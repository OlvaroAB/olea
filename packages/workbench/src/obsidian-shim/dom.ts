/**
 * Runtime half of Obsidian's DOM helpers (types in `dom-augment.d.ts`).
 *
 * `installObsidianDomHelpers(win)` is called from `main.ts` before any view is
 * constructed — the same ordering Obsidian gives a plugin, where these helpers
 * already exist by the time `onload` runs.
 *
 * **It takes a window because the host pane is its own document** (`ol-mioe`,
 * `../host-frame.ts`). Prototypes are per-realm: an element created inside the
 * frame gets the frame's `Element.prototype`, so patching only the top window
 * would leave every element the view creates without `createDiv`. Both realms
 * are patched, and `createEl` creates through `this.ownerDocument` rather than
 * the ambient global `document` — which is what makes these helpers correct in
 * *any* document rather than only in the one that happened to be loaded first.
 *
 * Obsidian's own helpers behave the same way, and for the same reason: it pops
 * tabs out into separate windows.
 */

interface DomElementInfoLike {
  readonly cls?: string | readonly string[];
  readonly text?: string;
  readonly attr?: Readonly<Record<string, string | number | boolean | null>>;
}

function applyInfo(el: HTMLElement, info: DomElementInfoLike | string | undefined): void {
  if (info === undefined) return;
  if (typeof info === 'string') {
    el.textContent = info;
    return;
  }
  if (info.cls !== undefined) {
    const classes = typeof info.cls === 'string' ? info.cls.split(/\s+/) : info.cls;
    for (const cls of classes) {
      if (cls.length > 0) el.classList.add(cls);
    }
  }
  if (info.text !== undefined) el.textContent = info.text;
  if (info.attr !== undefined) {
    for (const [name, value] of Object.entries(info.attr)) {
      if (value === null || value === false) el.removeAttribute(name);
      else el.setAttribute(name, String(value));
    }
  }
}

/**
 * A window whose constructors are reachable — `Window` alone does not declare
 * `Element`/`HTMLElement`, and it is exactly those per-realm constructors that
 * this module patches.
 */
export type Realm = Window & typeof globalThis;

const installed = new WeakSet<Realm>();

export function installObsidianDomHelpers(win: Realm = window): void {
  if (installed.has(win)) return;
  installed.add(win);

  const element = win.Element.prototype;
  const html = win.HTMLElement.prototype;

  element.empty = function empty(this: Element): void {
    while (this.firstChild !== null) this.removeChild(this.firstChild);
  };

  element.addClass = function addClass(this: Element, ...classes: string[]): void {
    for (const cls of classes) {
      if (cls.length > 0) this.classList.add(cls);
    }
  };

  element.removeClass = function removeClass(this: Element, ...classes: string[]): void {
    for (const cls of classes) this.classList.remove(cls);
  };

  element.toggleClass = function toggleClass(
    this: Element,
    classes: string | readonly string[],
    value: boolean,
  ): void {
    const list = typeof classes === 'string' ? [classes] : classes;
    for (const cls of list) this.classList.toggle(cls, value);
  };

  element.setAttr = function setAttr(
    this: Element,
    name: string,
    value: string | number | boolean | null,
  ): void {
    if (value === null || value === false) this.removeAttribute(name);
    else this.setAttribute(name, String(value));
  };

  element.setText = function setText(this: Element, value: string): void {
    this.textContent = value;
  };

  html.createEl = function createEl<K extends keyof HTMLElementTagNameMap>(
    this: HTMLElement,
    tag: K,
    info?: DomElementInfoLike | string,
  ): HTMLElementTagNameMap[K] {
    // `this.ownerDocument`, never the ambient `document`: an element inside the
    // host frame must create its children in the frame's document, or they
    // arrive with the wrong realm's prototype and no Obsidian helpers on it.
    const child = this.ownerDocument.createElement(tag);
    applyInfo(child, info);
    this.appendChild(child);
    return child;
  };

  html.createDiv = function createDiv(
    this: HTMLElement,
    info?: DomElementInfoLike | string,
  ): HTMLDivElement {
    return this.createEl('div', info);
  };

  html.createSpan = function createSpan(
    this: HTMLElement,
    info?: DomElementInfoLike | string,
  ): HTMLSpanElement {
    return this.createEl('span', info);
  };
}
