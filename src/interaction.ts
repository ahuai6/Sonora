export function isInteractiveTarget(target: EventTarget | null) {
  return (
    target instanceof Element &&
    !!target.closest(
      "input,textarea,select,button,a,summary,[role=button],[role=switch],[contenteditable=true],[role=dialog]",
    )
  );
}
