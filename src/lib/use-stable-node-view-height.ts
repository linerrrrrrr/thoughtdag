import { useState, type RefObject } from 'react';

/** Hold an automatic card's current footprint while the person uses its UI.
 * Committed content or detail changes invalidate the hold; width changes
 * release it once editing ends. The held height is never written into the graph. */
export function useStableNodeViewHeight(root: RefObject<HTMLElement | null>, enabled: boolean, identity: readonly unknown[],
  width: number | undefined, retainDuringEdit: boolean, holdOnlyWhileEditing = false) {
  const [snapshot, setSnapshot] = useState<{ height: number; identity: readonly unknown[]; width: number | undefined }>();
  const matches = !!snapshot && snapshot.identity.length === identity.length
    && snapshot.identity.every((value, index) => Object.is(value, identity[index]))
    && (retainDuringEdit || Object.is(snapshot.width, width));
  const height = enabled && matches && (!holdOnlyWhileEditing || retainDuringEdit) ? snapshot.height : undefined;
  const capture = () => {
    if (!enabled || height !== undefined || !root.current?.isConnected) return;
    const current = root.current.offsetHeight;
    if (current > 0 && !(matches && current === snapshot.height)) setSnapshot({ height: current, identity, width });
  };
  return { height, capture };
}
