// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const inputVariants: (props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | "matte" | "underline" | "filled" | "liquid" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type InputProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & VariantProps<typeof inputVariants>;
export declare const Input: React.ForwardRefExoticComponent<Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | "matte" | "underline" | "filled" | "liquid" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLInputElement>>;
export {};
