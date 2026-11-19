// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import { jsx as _jsx } from "react/jsx-runtime";
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
export const TooltipProvider = TooltipPrimitive.Provider;
export const Tooltip = ({ delayDuration, ...props }) => (_jsx(TooltipPrimitive.Root, { delayDuration: delayDuration, ...props }));
export const TooltipTrigger = TooltipPrimitive.Trigger;
const tooltipContentVariants = cva("z-50 overflow-hidden rounded-md px-3 py-1.5 text-xs shadow-md", {
    variants: {
        variant: {
            default: "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900",
            glass: [
                "border border-white/20 [border-top-color:var(--glass-refraction-top)]",
                "bg-[var(--glass-3-surface)] text-[var(--color-foreground)]",
                "backdrop-blur-xl backdrop-saturate-[180%]",
                "shadow-[0_0_0_1px_rgb(255_255_255_/_0.1)_inset,var(--shadow-glass-sm)]",
                "dark:border-white/[0.1] dark:shadow-[0_0_0_1px_rgb(255_255_255_/_0.05)_inset,0_4px_12px_rgb(0_0_0_/_0.35)]"
            ].join(" "),
            frosted: [
                "border border-white/30 [border-top-color:var(--glass-refraction-top)]",
                "bg-[var(--glass-4-surface)] text-[var(--color-foreground)]",
                "backdrop-blur-[40px] backdrop-saturate-[200%]",
                "shadow-[0_0_0_1px_rgb(255_255_255_/_0.15)_inset,0_0_12px_rgb(255_255_255_/_0.1)_inset,var(--shadow-glass-sm)]",
                "dark:border-white/[0.14] dark:shadow-[0_0_0_1px_rgb(255_255_255_/_0.07)_inset,0_0_12px_rgb(255_255_255_/_0.03)_inset,0_4px_12px_rgb(0_0_0_/_0.35)]"
            ].join(" ")
        }
    },
    defaultVariants: {
        variant: "default"
    }
});
export const TooltipContent = React.forwardRef(({ className, variant, sideOffset = 6, ...props }, ref) => (_jsx(TooltipPrimitive.Portal, { children: _jsx(TooltipPrimitive.Content, { ref: ref, sideOffset: sideOffset, className: cn(tooltipContentVariants({ variant }), className), ...props }) })));
TooltipContent.displayName = "TooltipContent";
