const VISITOR_ACTIVITY_EVENTS = new Set([
  "pointerdown",
  "touchstart",
  "keydown",
  "input",
  "change",
  "click",
  "scroll",
]);

export function isVisitorActivityEvent(event) {
  if (!VISITOR_ACTIVITY_EVENTS.has(event?.type)) return false;
  return !event.target?.closest?.("[data-visitor-timer]");
}
