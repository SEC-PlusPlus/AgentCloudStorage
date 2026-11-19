// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { cn } from "../lib/cn";
export const DotPattern = React.forwardRef(({ className, dotSize = 1.5, gap = 20, dotColor = "currentColor", dotOpacity = 0.2, cr, ...props }, ref) => {
    const id = React.useId();
    const patternId = `dot-pattern-${id}`;
    const radius = cr ?? dotSize;
    return (_jsxs("svg", { ref: ref, "aria-hidden": true, className: cn("pointer-events-none absolute inset-0 h-full w-full fill-neutral-400/40", className), ...props, children: [_jsx("defs", { children: _jsx("pattern", { id: patternId, x: 0, y: 0, width: gap, height: gap, patternUnits: "userSpaceOnUse", children: _jsx("circle", { cx: dotSize, cy: dotSize, r: radius, fill: dotColor, fillOpacity: dotOpacity }) }) }), _jsx("rect", { width: "100%", height: "100%", fill: `url(#${patternId})` })] }));
});
DotPattern.displayName = "DotPattern";
