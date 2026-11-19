// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
const headingVariants = cva("font-semibold tracking-tight text-[var(--color-foreground)]", {
    variants: {
        variant: {
            default: "",
            glass: "inline-block rounded-lg border border-white/20 [border-top-color:var(--glass-refraction-top)] bg-[var(--glass-1-surface)] px-2.5 py-1.5 dark:border-white/[0.14] dark:bg-white/[0.05]",
            outline: "inline-block rounded-lg border border-[var(--color-border)] px-2.5 py-1.5 dark:border-white/20",
            ghost: "inline-block rounded-lg px-2.5 py-1.5"
        },
        size: {
            sm: "text-lg leading-7",
            md: "text-2xl leading-9",
            lg: "text-3xl leading-10"
        }
    },
    defaultVariants: {
        variant: "default",
        size: "md"
    }
});
export const Heading = React.forwardRef(({ className, variant, size, level = 2, ...props }, ref) => {
    const Comp = `h${level}`;
    return _jsx(Comp, { ref: ref, className: cn(headingVariants({ variant, size }), className), ...props });
});
Heading.displayName = "Heading";
