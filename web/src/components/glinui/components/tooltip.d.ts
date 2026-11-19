// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { type VariantProps } from "class-variance-authority";
export declare const TooltipProvider: React.FC<TooltipPrimitive.TooltipProviderProps>;
export type TooltipProps = Omit<React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Root>, "onOpenChange"> & {
    /** Controlled open state. */
    open?: boolean;
    /** Initial open state for uncontrolled usage. */
    defaultOpen?: boolean;
    /** Callback when open state changes. */
    onOpenChange?: (open: boolean) => void;
    /** Delay in ms before showing tooltip content. */
    delayDuration?: number;
};
export declare const Tooltip: ({ delayDuration, ...props }: TooltipProps) => import("react/jsx-runtime").JSX.Element;
export declare const TooltipTrigger: React.ForwardRefExoticComponent<TooltipPrimitive.TooltipTriggerProps & React.RefAttributes<HTMLButtonElement>>;
declare const tooltipContentVariants: (props?: ({
    variant?: "default" | "glass" | "frosted" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type TooltipContentProps = React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & VariantProps<typeof tooltipContentVariants> & {
    /** Preferred side for tooltip content. */
    side?: "top" | "right" | "bottom" | "left";
    /** Gap in px between trigger and content. */
    sideOffset?: number;
};
export declare const TooltipContent: React.ForwardRefExoticComponent<Omit<TooltipPrimitive.TooltipContentProps & React.RefAttributes<HTMLDivElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & {
    /** Preferred side for tooltip content. */
    side?: "top" | "right" | "bottom" | "left";
    /** Gap in px between trigger and content. */
    sideOffset?: number;
} & React.RefAttributes<HTMLDivElement>>;
export {};
