// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const textVariants: (props?: ({
    variant?: "default" | "glass" | "ghost" | "muted" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type TextProps = React.HTMLAttributes<HTMLParagraphElement> & VariantProps<typeof textVariants>;
export declare const Text: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLParagraphElement> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "ghost" | "muted" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLParagraphElement>>;
export {};
