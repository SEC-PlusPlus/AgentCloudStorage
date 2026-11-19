// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
export interface AuroraBackgroundProps extends React.HTMLAttributes<HTMLDivElement> {
    /** Number of gradient blobs */
    blobCount?: number;
    /** Base colors for the aurora */
    colors?: string[];
    /** Animation duration in seconds */
    duration?: number;
    /** Blur intensity in px */
    blur?: number;
    /** Opacity of the aurora layer (0-1) */
    intensity?: number;
}
export declare const AuroraBackground: React.ForwardRefExoticComponent<AuroraBackgroundProps & React.RefAttributes<HTMLDivElement>>;
