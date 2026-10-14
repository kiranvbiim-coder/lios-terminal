/** A preserved workspace must not intercept contextual setup or modal input. */
export function canHandleWorkspaceShortcut(
  event: Pick<KeyboardEvent, "defaultPrevented" | "target">,
  root: Pick<Document, "querySelector"> = document,
): boolean {
  if (event.defaultPrevented || root.querySelector("[data-lios-workspace][hidden]")) return false;
  const target = event.target as Element | null;
  return !(typeof target?.closest === "function" && target.closest('[role="dialog"], [role="alertdialog"]'));
}
