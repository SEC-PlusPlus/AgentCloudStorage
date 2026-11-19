// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const buttonVariants: (props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | "matte" | "liquid" | "glow" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
};
export declare const Button: React.ForwardRefExoticComponent<React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | "matte" | "liquid" | "glow" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & {
    asChild?: boolean;
} & React.RefAttributes<HTMLButtonElement>>;
export {};
