import { createContext } from 'react';
import type { EdgeRoutingContext } from './edge-path';
import type { ConnectionLayout } from './connection-layout-preferences';

/** Shared geometry is prepared once per canvas update, never persisted. */
export const CanvasEdgeRouting = createContext<EdgeRoutingContext | undefined>(undefined);
export const CanvasConnectionLayout = createContext<ConnectionLayout | undefined>(undefined);
/** Static rendering emits label contents beside the SVG, in place of a React portal. */
export const StaticEdgeLabels = createContext(false);
