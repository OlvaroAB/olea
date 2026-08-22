/**
 * The *type* half of Obsidian's DOM helpers. Obsidian patches these onto the
 * global `Element`/`HTMLElement` prototypes at runtime and declares them
 * globally in its own typings; `dom.ts` next door installs the runtime half.
 *
 * This is chrome by any reading: `createDiv({ cls, text })` is sugar over
 * `document.createElement`, and nothing here knows what a review card is. It is
 * also the largest single surface the shim has, which is worth saying out loud —
 * see the package README's shim ledger.
 *
 * Only the members `packages/plugin/src/review/view.ts` actually calls are
 * declared. Adding one because a *new* view wants it is the moment to stop and
 * ask WB-1's question: is the view holding logic, or is this really chrome?
 */

declare global {
  /** Obsidian's `DomElementInfo`, narrowed to the fields the review view passes. */
  interface OleaShimDomElementInfo {
    readonly cls?: string | readonly string[];
    readonly text?: string;
    readonly attr?: Readonly<Record<string, string | number | boolean | null>>;
  }

  interface Element {
    empty(): void;
    addClass(...classes: string[]): void;
    removeClass(...classes: string[]): void;
    toggleClass(classes: string | readonly string[], value: boolean): void;
    setAttr(qualifiedName: string, value: string | number | boolean | null): void;
    setText(value: string): void;
  }

  interface HTMLElement {
    createDiv(info?: OleaShimDomElementInfo | string): HTMLDivElement;
    createSpan(info?: OleaShimDomElementInfo | string): HTMLSpanElement;
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      info?: OleaShimDomElementInfo | string,
    ): HTMLElementTagNameMap[K];
  }
}

export {};
