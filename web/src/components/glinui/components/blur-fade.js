// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
"use client";
import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { cn } from "../lib/cn";
export const BlurFade = React.forwardRef(({ className, children, delay = 0, duration = 500, blur = 8, yOffset = 12, once = true, threshold = 0.1, style, ...props }, ref) => {
    const localRef = React.useRef(null);
    const [isVisible, setIsVisible] = React.useState(false);
    const setRefs = React.useCallback((node) => {
        localRef.current = node;
        if (typeof ref === "function") {
            ref(node);
        }
        else if (ref) {
            ref.current = node;
        }
    }, [ref]);
    React.useEffect(() => {
        const el = localRef.current;
        if (!el)
            return;
        const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (prefersReduced) {
            setIsVisible(true);
            return;
        }
        const observer = new IntersectionObserver(([entry]) => {
            if (entry.isIntersecting) {
                setIsVisible(true);
                if (once)
                    observer.unobserve(el);
            }
            else if (!once) {
                setIsVisible(false);
            }
        }, { threshold });
        observer.observe(el);
        return () => observer.disconnect();
    }, [once, threshold]);
    return (_jsx("div", { ref: setRefs, className: cn("transition-[opacity,filter,transform] ease-standard motion-reduce:!opacity-100 motion-reduce:!filter-none motion-reduce:!transform-none", className), style: {
            transitionDuration: `${duration}ms`,
            transitionDelay: `${delay}ms`,
            opacity: isVisible ? 1 : 0,
            filter: isVisible ? "blur(0px)" : `blur(${blur}px)`,
            transform: isVisible ? "translateY(0)" : `translateY(${yOffset}px)`,
            ...style,
        }, ...props, children: children }));
});
BlurFade.displayName = "BlurFade";
