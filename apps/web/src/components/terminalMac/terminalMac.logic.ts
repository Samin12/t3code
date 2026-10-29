export type GuestDisplay = {
  width: number;
  height: number;
  pointWidth: number;
  pointHeight: number;
};
export function pointerToGuest(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  display: GuestDisplay,
  clamp = false,
) {
  if (
    rect.width <= 0 ||
    rect.height <= 0 ||
    display.width <= 0 ||
    display.height <= 0 ||
    display.pointWidth <= 0 ||
    display.pointHeight <= 0
  )
    return null;
  const scale = Math.min(rect.width / display.width, rect.height / display.height);
  const width = display.width * scale,
    height = display.height * scale;
  const x = clientX - rect.left - (rect.width - width) / 2;
  const y = clientY - rect.top - (rect.height - height) / 2;
  if (!clamp && (x < 0 || y < 0 || x >= width || y >= height)) return null;
  return {
    x: Math.max(0, Math.min(display.pointWidth - 1, Math.floor((x / width) * display.pointWidth))),
    y: Math.max(
      0,
      Math.min(display.pointHeight - 1, Math.floor((y / height) * display.pointHeight)),
    ),
  };
}

const keyNames: Record<string, string> = {
  Enter: "return",
  Backspace: "backspace",
  Delete: "delete",
  Escape: "escape",
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
  Tab: "tab",
  " ": "space",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
};
const punctuationCodes: Record<string, string> = {
  Equal: "=",
  Minus: "-",
  BracketLeft: "[",
  BracketRight: "]",
  Quote: "'",
  Semicolon: ";",
  Backslash: "\\",
  Comma: ",",
  Period: ".",
  Slash: "/",
};
export function guestKey(event: {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): { action: "type"; text: string } | { action: "key"; key: string } | null {
  if (Array.from(event.key).length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey)
    return { action: "type", text: event.key };
  let key = keyNames[event.key] ?? event.key.toLowerCase();
  if (
    !/^(?:[a-z0-9=\-[\]'\\;,/.]|return|backspace|delete|escape|left|right|up|down|tab|space|home|end|pageup|pagedown|f[1-9]|f1[0-2])$/.test(
      key,
    )
  ) {
    key =
      punctuationCodes[event.code ?? ""] ??
      (/^Key[A-Z]$/.test(event.code ?? "")
        ? event.code!.slice(3).toLowerCase()
        : /^Digit[0-9]$/.test(event.code ?? "")
          ? event.code!.slice(5)
          : "");
  }
  if (!key) return null;
  const modifiers = [
    event.metaKey && "cmd",
    event.ctrlKey && "ctrl",
    event.altKey && "option",
    event.shiftKey && "shift",
  ].filter(Boolean);
  return { action: "key", key: [...modifiers, key].join("+") };
}
