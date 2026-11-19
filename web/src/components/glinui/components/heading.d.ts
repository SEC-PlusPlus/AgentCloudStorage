// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
declare const headingVariants: (props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type HeadingProps = React.HTMLAttributes<HTMLHeadingElement> & VariantProps<typeof headingVariants> & {
    level?: HeadingLevel;
};
export declare const Heading: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLHeadingElement> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & {
    level?: HeadingLevel;
} & React.RefAttributes<HTMLHeadingElement>>;
export {};
