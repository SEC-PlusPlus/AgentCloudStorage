// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const skeletonVariants: (props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | "matte" | "liquid" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type SkeletonProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof skeletonVariants> & {
    decorative?: boolean;
};
export declare const Skeleton: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLDivElement> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | "matte" | "liquid" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & {
    decorative?: boolean;
} & React.RefAttributes<HTMLDivElement>>;
export {};
