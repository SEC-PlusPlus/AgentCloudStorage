// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
"use client";
import * as React from "react";
const QUERY = "(prefers-reduced-motion: reduce)";
export function usePrefersReducedMotion() {
    const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);
    React.useEffect(() => {
        if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
            return;
        }
        const mediaQuery = window.matchMedia(QUERY);
        const handleChange = () => {
            setPrefersReducedMotion(mediaQuery.matches);
        };
        handleChange();
        if (typeof mediaQuery.addEventListener === "function") {
            mediaQuery.addEventListener("change", handleChange);
            return () => mediaQuery.removeEventListener("change", handleChange);
        }
        mediaQuery.addListener(handleChange);
        return () => mediaQuery.removeListener(handleChange);
    }, []);
    return prefersReducedMotion;
}
