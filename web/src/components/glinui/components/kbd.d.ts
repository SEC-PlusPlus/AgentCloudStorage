// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const kbdVariants: (props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type KbdProps = React.HTMLAttributes<HTMLElement> & VariantProps<typeof kbdVariants>;
export declare const Kbd: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLElement> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLElement>>;
export {};
