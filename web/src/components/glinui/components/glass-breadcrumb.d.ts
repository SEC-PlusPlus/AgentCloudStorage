// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
export interface GlassBreadcrumbItem {
    id: string;
    label: React.ReactNode;
    href?: string;
    onClick?: () => void;
}
export interface GlassBreadcrumbProps extends React.HTMLAttributes<HTMLElement> {
    /** Breadcrumb items */
    items: GlassBreadcrumbItem[];
    /** Separator character */
    separator?: React.ReactNode;
    /** Max items to show (rest collapsed) */
    maxItems?: number;
}
export declare const GlassBreadcrumb: React.ForwardRefExoticComponent<GlassBreadcrumbProps & React.RefAttributes<HTMLElement>>;
