// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { type VariantProps } from "class-variance-authority";
declare const dropdownMenuTriggerVariants: (props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare const dropdownMenuContentVariants: (props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare const dropdownMenuItemVariants: (props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type DropdownMenuProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Root>;
export declare const DropdownMenu: React.FC<DropdownMenuPrimitive.DropdownMenuProps>;
export type DropdownMenuTriggerProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Trigger> & VariantProps<typeof dropdownMenuTriggerVariants>;
export declare const DropdownMenuTrigger: React.ForwardRefExoticComponent<Omit<DropdownMenuPrimitive.DropdownMenuTriggerProps & React.RefAttributes<HTMLButtonElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLButtonElement>>;
export type DropdownMenuContentProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & VariantProps<typeof dropdownMenuContentVariants>;
export declare const DropdownMenuContent: React.ForwardRefExoticComponent<Omit<DropdownMenuPrimitive.DropdownMenuContentProps & React.RefAttributes<HTMLDivElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLDivElement>>;
export type DropdownMenuItemProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & VariantProps<typeof dropdownMenuItemVariants> & {
    inset?: boolean;
};
export declare const DropdownMenuItem: React.ForwardRefExoticComponent<Omit<DropdownMenuPrimitive.DropdownMenuItemProps & React.RefAttributes<HTMLDivElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & {
    inset?: boolean;
} & React.RefAttributes<HTMLDivElement>>;
export type DropdownMenuCheckboxItemProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem> & VariantProps<typeof dropdownMenuItemVariants>;
export declare const DropdownMenuCheckboxItem: React.ForwardRefExoticComponent<Omit<DropdownMenuPrimitive.DropdownMenuCheckboxItemProps & React.RefAttributes<HTMLDivElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLDivElement>>;
export declare const DropdownMenuRadioGroup: React.ForwardRefExoticComponent<DropdownMenuPrimitive.DropdownMenuRadioGroupProps & React.RefAttributes<HTMLDivElement>>;
export type DropdownMenuRadioItemProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem> & VariantProps<typeof dropdownMenuItemVariants>;
export declare const DropdownMenuRadioItem: React.ForwardRefExoticComponent<Omit<DropdownMenuPrimitive.DropdownMenuRadioItemProps & React.RefAttributes<HTMLDivElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLDivElement>>;
export type DropdownMenuLabelProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean;
};
export declare const DropdownMenuLabel: React.ForwardRefExoticComponent<Omit<DropdownMenuPrimitive.DropdownMenuLabelProps & React.RefAttributes<HTMLDivElement>, "ref"> & {
    inset?: boolean;
} & React.RefAttributes<HTMLDivElement>>;
export type DropdownMenuSeparatorProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>;
export declare const DropdownMenuSeparator: React.ForwardRefExoticComponent<Omit<DropdownMenuPrimitive.DropdownMenuSeparatorProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
export type DropdownMenuShortcutProps = React.HTMLAttributes<HTMLSpanElement>;
export declare const DropdownMenuShortcut: ({ className, ...props }: DropdownMenuShortcutProps) => import("react/jsx-runtime").JSX.Element;
export declare const DropdownMenuSub: React.FC<DropdownMenuPrimitive.DropdownMenuSubProps>;
export type DropdownMenuSubTriggerProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & VariantProps<typeof dropdownMenuItemVariants> & {
    inset?: boolean;
};
export declare const DropdownMenuSubTrigger: React.ForwardRefExoticComponent<Omit<DropdownMenuPrimitive.DropdownMenuSubTriggerProps & React.RefAttributes<HTMLDivElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & {
    inset?: boolean;
} & React.RefAttributes<HTMLDivElement>>;
export type DropdownMenuSubContentProps = React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent> & VariantProps<typeof dropdownMenuContentVariants>;
export declare const DropdownMenuSubContent: React.ForwardRefExoticComponent<Omit<DropdownMenuPrimitive.DropdownMenuSubContentProps & React.RefAttributes<HTMLDivElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLDivElement>>;
export {};
