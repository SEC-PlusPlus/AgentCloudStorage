// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const badgeVariants: (props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | "matte" | "liquid" | "glow" | "success" | "warning" | "destructive" | "info" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;
export declare const Badge: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLSpanElement> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | "matte" | "liquid" | "glow" | "success" | "warning" | "destructive" | "info" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLSpanElement>>;
export {};
