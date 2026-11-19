// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const avatarVariants: (props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | "matte" | "liquid" | "glow" | null | undefined;
    size?: "sm" | "md" | "lg" | "xs" | "xl" | "2xl" | null | undefined;
    radius?: "md" | "lg" | "square" | "full" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare const statusColors: {
    readonly online: "bg-emerald-500 shadow-[0_0_0_2px_var(--color-background)]";
    readonly offline: "bg-neutral-400 shadow-[0_0_0_2px_var(--color-background)] dark:bg-neutral-500";
    readonly busy: "bg-red-500 shadow-[0_0_0_2px_var(--color-background)]";
    readonly away: "bg-amber-500 shadow-[0_0_0_2px_var(--color-background)]";
};
export type AvatarStatus = keyof typeof statusColors;
export type AvatarProps = React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof avatarVariants> & {
    src?: string;
    alt?: string;
    fallback?: string;
    imgClassName?: string;
    fallbackClassName?: string;
    /** Online/offline status indicator */
    status?: AvatarStatus;
    /** Ring color for grouped avatars or emphasis */
    ring?: boolean;
};
export declare const Avatar: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLSpanElement> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | "matte" | "liquid" | "glow" | null | undefined;
    size?: "sm" | "md" | "lg" | "xs" | "xl" | "2xl" | null | undefined;
    radius?: "md" | "lg" | "square" | "full" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & {
    src?: string;
    alt?: string;
    fallback?: string;
    imgClassName?: string;
    fallbackClassName?: string;
    /** Online/offline status indicator */
    status?: AvatarStatus;
    /** Ring color for grouped avatars or emphasis */
    ring?: boolean;
} & React.RefAttributes<HTMLSpanElement>>;
export type AvatarGroupProps = React.HTMLAttributes<HTMLDivElement> & {
    /** Max avatars to show before +N overflow */
    max?: number;
    /** Overlap spacing */
    spacing?: "tight" | "normal" | "loose";
};
export declare const AvatarGroup: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLDivElement> & {
    /** Max avatars to show before +N overflow */
    max?: number;
    /** Overlap spacing */
    spacing?: "tight" | "normal" | "loose";
} & React.RefAttributes<HTMLDivElement>>;
export {};
