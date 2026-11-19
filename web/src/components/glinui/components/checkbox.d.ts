// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { type VariantProps } from "class-variance-authority";
declare const checkboxVariants: (props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "matte" | "liquid" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type CheckboxProps = React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & VariantProps<typeof checkboxVariants>;
export declare const Checkbox: React.ForwardRefExoticComponent<Omit<CheckboxPrimitive.CheckboxProps & React.RefAttributes<HTMLButtonElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "matte" | "liquid" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLButtonElement>>;
export {};
