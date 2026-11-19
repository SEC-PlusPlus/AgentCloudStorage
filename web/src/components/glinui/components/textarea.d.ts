// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const textareaVariants: (props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | "matte" | "underline" | "filled" | "liquid" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type TextareaProps = Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> & VariantProps<typeof textareaVariants>;
export declare const Textarea: React.ForwardRefExoticComponent<Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | "matte" | "underline" | "filled" | "liquid" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLTextAreaElement>>;
export {};
