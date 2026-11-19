// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
const labelVariants = cva("inline-flex items-center gap-1.5 font-medium text-[var(--color-foreground)] transition-colors duration-fast ease-standard motion-reduce:transition-none", {
    variants: {
        variant: {
            default: "",
            glass: "rounded-md border border-white/20 [border-top-color:var(--glass-refraction-top)] bg-[var(--glass-1-surface)] px-2 py-1 dark:border-white/[0.14] dark:bg-white/[0.05]",
            outline: "rounded-md border border-[var(--color-border)] px-2 py-1 dark:border-white/20",
            ghost: "rounded-md px-2 py-1 text-[var(--color-foreground)]/75"
        },
        size: {
            sm: "text-xs",
            md: "text-sm",
            lg: "text-base"
        }
    },
    defaultVariants: {
        variant: "default",
        size: "md"
    }
});
export const Label = React.forwardRef(({ className, variant, size, ...props }, ref) => {
    return _jsx("label", { ref: ref, className: cn(labelVariants({ variant, size }), className), ...props });
});
Label.displayName = "Label";
