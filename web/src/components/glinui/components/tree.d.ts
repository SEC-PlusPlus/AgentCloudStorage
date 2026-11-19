// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const treeVariants: (props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type TreeNode = {
    /** Display label */
    label: string;
    /** Optional href — makes the node a link */
    href?: string;
    /** Open link in new tab */
    external?: boolean;
    /** Optional badge text shown after the label */
    badge?: string;
    /** Badge color variant */
    badgeVariant?: "default" | "success" | "warning" | "info" | "destructive";
    /** Nested children — presence makes this a folder */
    children?: TreeNode[];
    /** Custom icon override */
    icon?: React.ReactNode;
};
export type TreeProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof treeVariants> & {
    /** Extra classes for the tree root wrapper. */
    className?: string;
    /** Tree data */
    nodes: TreeNode[];
    /** Expand all folders by default */
    defaultExpanded?: boolean;
};
export declare const Tree: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLDivElement> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & {
    /** Extra classes for the tree root wrapper. */
    className?: string;
    /** Tree data */
    nodes: TreeNode[];
    /** Expand all folders by default */
    defaultExpanded?: boolean;
} & React.RefAttributes<HTMLDivElement>>;
export declare function buildFileTree(paths: string[], options?: {
    /** Base href prefix for leaf nodes */
    hrefPrefix?: string;
    /** Custom badge function per file path */
    getBadge?: (path: string) => {
        badge: string;
        badgeVariant?: TreeNode["badgeVariant"];
    } | null;
}): TreeNode[];
export {};
