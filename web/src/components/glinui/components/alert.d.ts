// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const alertVariants: (props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | "matte" | "liquid" | "glow" | "success" | "warning" | "destructive" | "info" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type AlertProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>;
export declare const Alert: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLDivElement> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | "matte" | "liquid" | "glow" | "success" | "warning" | "destructive" | "info" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLDivElement>>;
export declare const AlertTitle: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLHeadingElement> & React.RefAttributes<HTMLHeadingElement>>;
export declare const AlertDescription: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLParagraphElement> & React.RefAttributes<HTMLParagraphElement>>;
export {};
