// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const glassNavbarVariants: (props?: ({
    elevation?: "base" | "scrolled" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type GlassNavbarProps = React.HTMLAttributes<HTMLElement> & Omit<VariantProps<typeof glassNavbarVariants>, "elevation"> & {
    scrollThreshold?: number;
    disableScrollTracking?: boolean;
    elevation?: VariantProps<typeof glassNavbarVariants>["elevation"];
};
export declare const GlassNavbar: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLElement> & Omit<VariantProps<(props?: ({
    elevation?: "base" | "scrolled" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string>, "elevation"> & {
    scrollThreshold?: number;
    disableScrollTracking?: boolean;
    elevation?: VariantProps<typeof glassNavbarVariants>["elevation"];
} & React.RefAttributes<HTMLElement>>;
export {};
