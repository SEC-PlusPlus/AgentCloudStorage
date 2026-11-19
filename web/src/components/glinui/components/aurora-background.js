// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { cn } from "../lib/cn";
export const AuroraBackground = React.forwardRef(({ className, children, blobCount = 3, colors = ["#a855f7", "#6366f1", "#ec4899"], duration = 8, blur = 80, intensity = 0.4, style, ...props }, ref) => {
    const blobs = React.useMemo(() => {
        return Array.from({ length: blobCount }, (_, i) => ({
            id: i,
            color: colors[i % colors.length],
            delay: (i * duration) / blobCount,
            size: 40 + (i % 3) * 15,
            x: 20 + (i * 60) / blobCount,
            y: 20 + ((i * 40) % 60),
        }));
    }, [blobCount, colors, duration]);
    return (_jsxs("div", { ref: ref, "aria-hidden": true, className: cn("pointer-events-none absolute inset-0 overflow-hidden", className), style: style, ...props, children: [_jsx("div", { className: "absolute inset-0", style: { filter: `blur(${blur}px)`, opacity: intensity }, children: blobs.map((blob) => (_jsx("div", { className: "absolute rounded-full animate-aurora-shift motion-reduce:[animation:none]", style: {
                        "--aurora-duration": `${duration}s`,
                        width: `${blob.size}%`,
                        height: `${blob.size}%`,
                        left: `${blob.x}%`,
                        top: `${blob.y}%`,
                        background: `radial-gradient(circle, ${blob.color}, transparent 70%)`,
                        animationDelay: `${-blob.delay}s`,
                        transform: "translate(-50%, -50%)",
                    } }, blob.id))) }), children] }));
});
AuroraBackground.displayName = "AuroraBackground";
