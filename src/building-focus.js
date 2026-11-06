// An overview can be 3D while still too wide to load individual buildings.
// Keep the user's current location; never substitute a showcase city.
export function buildingFocusCamera(view, limited = false) {
  if (!Array.isArray(view?.center) || view.center.length !== 2 || !view.center.every(Number.isFinite) || !Number.isFinite(view.zoom)) return null;
  const zoom=Math.min(20,Math.max(15.5,view.zoom+(limited && view.zoom>=15.5 ? 1 : 0)));
  return {center:[...view.center],zoom};
}
