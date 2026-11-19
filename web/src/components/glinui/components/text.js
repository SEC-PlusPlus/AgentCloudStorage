// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
const textVariants = cva("transition-colors duration-fast ease-standard motion-reduce:transition-none", {
    variants: {
        variant: {
            default: "text-[var(--color-foreground)]",
            muted: "text-neutral-600 dark:text-neutral-300",
            glass: "rounded-md border border-white/20 [border-top-color:var(--glass-refraction-top)] bg-[var(--glass-1-surface)] px-2 py-1 text-[var(--color-foreground)] dark:border-white/[0.14] dark:bg-white/[0.05]",
            ghost: "rounded-md px-2 py-1 text-[var(--color-foreground)]/85"
        },
        size: {
            sm: "text-xs leading-5",
            md: "text-sm leading-6",
            lg: "text-base leading-7"
        }
    },
    defaultVariants: {
        variant: "default",
        size: "md"
    }
});
export const Text = React.forwardRef(({ className, variant, size, ...props }, ref) => {
    return _jsx("p", { ref: ref, className: cn(textVariants({ variant, size }), className), ...props });
});
Text.displayName = "Text";
