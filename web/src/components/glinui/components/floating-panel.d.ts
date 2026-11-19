// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
export interface FloatingPanelProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Enable dragging */
    draggable?: boolean;
    /** Initial x position */
    defaultX?: number;
    /** Initial y position */
    defaultY?: number;
    /** Panel width */
    width?: number | string;
    /** Show close button */
    closable?: boolean;
    /** Close callback */
    onClose?: () => void;
}
export declare const FloatingPanel: React.ForwardRefExoticComponent<FloatingPanelProps & React.RefAttributes<HTMLDivElement>>;
