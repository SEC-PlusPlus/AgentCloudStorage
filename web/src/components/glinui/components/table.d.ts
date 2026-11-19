// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import { type VariantProps } from "class-variance-authority";
declare const tableWrapperVariants: (props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | "matte" | "liquid" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare const tableRowToneVariants: (props?: ({
    tone?: "default" | "success" | "warning" | "info" | "danger" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type TableProps = React.HTMLAttributes<HTMLTableElement> & VariantProps<typeof tableWrapperVariants> & {
    containerClassName?: string;
    striped?: boolean;
    interactive?: boolean;
    stickyHeader?: boolean;
    stickyFirstColumn?: boolean;
    grid?: boolean;
    noWrap?: boolean;
    rowDividers?: boolean;
    layout?: "auto" | "fixed";
};
export declare const Table: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLTableElement> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "outline" | "ghost" | "matte" | "liquid" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & {
    containerClassName?: string;
    striped?: boolean;
    interactive?: boolean;
    stickyHeader?: boolean;
    stickyFirstColumn?: boolean;
    grid?: boolean;
    noWrap?: boolean;
    rowDividers?: boolean;
    layout?: "auto" | "fixed";
} & React.RefAttributes<HTMLTableElement>>;
export declare const TableHeader: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLTableSectionElement> & React.RefAttributes<HTMLTableSectionElement>>;
export declare const TableBody: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLTableSectionElement> & React.RefAttributes<HTMLTableSectionElement>>;
export declare const TableFooter: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLTableSectionElement> & React.RefAttributes<HTMLTableSectionElement>>;
export type TableRowTone = NonNullable<VariantProps<typeof tableRowToneVariants>["tone"]>;
export type TableRowProps = React.HTMLAttributes<HTMLTableRowElement> & {
    tone?: TableRowTone;
};
export declare const TableRow: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLTableRowElement> & {
    tone?: TableRowTone;
} & React.RefAttributes<HTMLTableRowElement>>;
export type TableHeadProps = React.ThHTMLAttributes<HTMLTableCellElement> & {
    align?: "left" | "center" | "right";
    sticky?: boolean;
};
export declare const TableHead: React.ForwardRefExoticComponent<React.ThHTMLAttributes<HTMLTableCellElement> & {
    align?: "left" | "center" | "right";
    sticky?: boolean;
} & React.RefAttributes<HTMLTableCellElement>>;
export type TableCellProps = React.TdHTMLAttributes<HTMLTableCellElement> & {
    align?: "left" | "center" | "right";
    truncate?: boolean;
    sticky?: boolean;
};
export declare const TableCell: React.ForwardRefExoticComponent<React.TdHTMLAttributes<HTMLTableCellElement> & {
    align?: "left" | "center" | "right";
    truncate?: boolean;
    sticky?: boolean;
} & React.RefAttributes<HTMLTableCellElement>>;
export declare const TableCaption: React.ForwardRefExoticComponent<React.HTMLAttributes<HTMLTableCaptionElement> & React.RefAttributes<HTMLTableCaptionElement>>;
export declare function TableEmpty({ colSpan, children }: {
    colSpan: number;
    children?: React.ReactNode;
}): import("react/jsx-runtime").JSX.Element;
export {};
