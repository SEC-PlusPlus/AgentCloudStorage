// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
export interface BlurFadeProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Delay before transition starts (ms) */
    delay?: number;
    /** Transition duration (ms) */
    duration?: number;
    /** Initial blur amount (px) */
    blur?: number;
    /** Initial Y offset (px) */
    yOffset?: number;
    /** Only animate once */
    once?: boolean;
    /** IntersectionObserver threshold (0-1) */
    threshold?: number;
}
export declare const BlurFade: React.ForwardRefExoticComponent<BlurFadeProps & React.RefAttributes<HTMLDivElement>>;
