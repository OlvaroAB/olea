/** A minimal fake of the DOM surface `PaperView` draws on (`createEl`, `createDiv`, `empty`, `addClass`, `addEventListener`), for specs that mount the view without a host. */
export class FakeEl {
  text = '';
  readonly children: FakeEl[] = [];
  private readonly handlers = new Map<string, (() => void)[]>();
  constructor(readonly tag: string) {}

  createEl(tag: string, options?: { text?: string; cls?: string }): FakeEl {
    const child = new FakeEl(tag);
    child.text = options?.text ?? '';
    this.children.push(child);
    return child;
  }
  createDiv(options?: { cls?: string }): FakeEl {
    return this.createEl('div', options);
  }
  addClass(_cls: string): void {}
  empty(): void {
    this.children.length = 0;
  }
  addEventListener(type: string, handler: () => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  click(): void {
    for (const handler of this.handlers.get('click') ?? []) handler();
  }
  allText(): string {
    return [this.text, ...this.children.map((child) => child.allText())]
      .filter((t) => t !== '')
      .join('\n');
  }
  find(tag: string): FakeEl[] {
    return [...(this.tag === tag ? [this] : []), ...this.children.flatMap((c) => c.find(tag))];
  }
}
