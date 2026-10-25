// Docker width is shared by dragging, keyboard resizing and restored settings.
export function panelWidth(value) {
  return Number.isFinite(value) ? Math.max(220, Math.min(520, Math.round(value))) : 290;
}
