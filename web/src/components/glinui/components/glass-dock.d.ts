// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
export interface GlassDockItem {
    id: string;
    icon: React.ReactNode;
    label: string;
    onClick?: () => void;
}
export interface GlassDockProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "children"> {
    /** Dock items */
    items: GlassDockItem[];
    /** Base icon size in px */
    iconSize?: number;
    /** Maximum magnification scale */
    magnification?: number;
    /** Distance in px at which magnification starts */
    distance?: number;
    /** Position */
    position?: "bottom" | "top" | "left" | "right";
}
export declare const GlassDock: React.ForwardRefExoticComponent<GlassDockProps & React.RefAttributes<HTMLDivElement>>;
