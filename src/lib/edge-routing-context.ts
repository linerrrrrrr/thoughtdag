import { createContext } from 'react';
import type { EdgeRoutingContext } from './edge-path';

/** Shared geometry is prepared once per canvas update, never persisted. */
export const CanvasEdgeRouting = createContext<EdgeRoutingContext | undefined>(undefined);
