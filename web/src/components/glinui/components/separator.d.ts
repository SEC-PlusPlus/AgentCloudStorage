// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const lineVariants: (props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | "dashed" | "dotted" | "gradient" | null | undefined;
    orientation?: "horizontal" | "vertical" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type SeparatorProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof lineVariants> & {
    /** When true the element is purely visual (default). When false, role="separator" is applied. */
    decorative?: boolean;
    /** Text label rendered centred on the separator line. */
    label?: string;
    /** Icon node rendered centred on the separator line. Overrides label when both are provided. */
    icon?: React.ReactNode;
};
export declare const Separator: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLDivElement> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | "dashed" | "dotted" | "gradient" | null | undefined;
    orientation?: "horizontal" | "vertical" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & {
    /** When true the element is purely visual (default). When false, role="separator" is applied. */
    decorative?: boolean;
    /** Text label rendered centred on the separator line. */
    label?: string;
    /** Icon node rendered centred on the separator line. Overrides label when both are provided. */
    icon?: React.ReactNode;
} & React.RefAttributes<HTMLDivElement>>;
export {};
