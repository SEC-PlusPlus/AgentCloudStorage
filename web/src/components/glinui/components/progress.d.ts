// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import * as ProgressPrimitive from "@radix-ui/react-progress";
import { type VariantProps } from "class-variance-authority";
declare const progressVariants: (props?: ({
    variant?: "default" | "glass" | "matte" | "liquid" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare const progressCircleVariants: (props?: ({
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type ProgressProps = React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root> & VariantProps<typeof progressVariants> & {
    /** Current progress value from 0 to 100. */
    value?: number;
    /** Render loading state without aria-valuenow and fixed width indicator. */
    indeterminate?: boolean;
};
export declare const Progress: React.ForwardRefExoticComponent<Omit<ProgressPrimitive.ProgressProps & React.RefAttributes<HTMLDivElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "matte" | "liquid" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & {
    /** Current progress value from 0 to 100. */
    value?: number;
    /** Render loading state without aria-valuenow and fixed width indicator. */
    indeterminate?: boolean;
} & React.RefAttributes<HTMLDivElement>>;
export type ProgressCircleProps = Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & VariantProps<typeof progressCircleVariants> & {
    value?: number;
    variant?: NonNullable<VariantProps<typeof progressVariants>["variant"]>;
    strokeWidth?: number;
    cap?: "round" | "square" | "butt";
    indeterminate?: boolean;
    showValue?: boolean;
    formatValue?: (value: number) => React.ReactNode;
};
export declare const ProgressCircle: React.ForwardRefExoticComponent<Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & VariantProps<(props?: ({
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & {
    value?: number;
    variant?: NonNullable<VariantProps<typeof progressVariants>["variant"]>;
    strokeWidth?: number;
    cap?: "round" | "square" | "butt";
    indeterminate?: boolean;
    showValue?: boolean;
    formatValue?: (value: number) => React.ReactNode;
} & React.RefAttributes<HTMLDivElement>>;
export declare const CircularProgress: React.ForwardRefExoticComponent<Omit<React.HTMLAttributes<HTMLDivElement>, "children"> & VariantProps<(props?: ({
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & {
    value?: number;
    variant?: NonNullable<VariantProps<typeof progressVariants>["variant"]>;
    strokeWidth?: number;
    cap?: "round" | "square" | "butt";
    indeterminate?: boolean;
    showValue?: boolean;
    formatValue?: (value: number) => React.ReactNode;
} & React.RefAttributes<HTMLDivElement>>;
export {};
