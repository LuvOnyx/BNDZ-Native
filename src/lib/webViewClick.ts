/**
 * WebView2 often drops click synthesis — commit simple actions on pointerdown/mousedown.
 */

export function isPrimaryPointerButton(e: { button: number }): boolean {
  return e.button === 0;
}

/** Run once per press; ignores chrome targets matched by selector. */
export function runWebViewPrimaryAction(
  e: React.MouseEvent | React.PointerEvent | MouseEvent | PointerEvent,
  handler: () => void,
  opts?: { chromeSelector?: string },
): void {
  if (!isPrimaryPointerButton(e)) return;
  const target = e.target as HTMLElement | null;
  if (opts?.chromeSelector && target?.closest?.(opts.chromeSelector)) return;
  e.preventDefault();
  e.stopPropagation();
  handler();
}
