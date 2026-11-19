// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { type VariantProps } from "class-variance-authority";
declare const sheetTriggerVariants: (props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare const sheetContentVariants: (props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
    side?: "left" | "right" | "bottom" | "top" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type SheetProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>;
export declare const Sheet: React.FC<DialogPrimitive.DialogProps>;
export declare const Drawer: React.FC<DialogPrimitive.DialogProps>;
export type SheetTriggerProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Trigger> & VariantProps<typeof sheetTriggerVariants>;
export declare const SheetTrigger: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogTriggerProps & React.RefAttributes<HTMLButtonElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLButtonElement>>;
export declare const SheetClose: React.ForwardRefExoticComponent<DialogPrimitive.DialogCloseProps & React.RefAttributes<HTMLButtonElement>>;
export type SheetPortalProps = DialogPrimitive.DialogPortalProps;
export declare const SheetPortal: (props: SheetPortalProps) => import("react/jsx-runtime").JSX.Element;
export type SheetOverlayProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>;
export declare const SheetOverlay: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogOverlayProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
export type SheetContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & VariantProps<typeof sheetContentVariants>;
export declare const SheetContent: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogContentProps & React.RefAttributes<HTMLDivElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "outline" | "ghost" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
    side?: "left" | "right" | "bottom" | "top" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLDivElement>>;
export type SheetHeaderProps = React.HTMLAttributes<HTMLDivElement>;
export declare const SheetHeader: React.ForwardRefExoticComponent<SheetHeaderProps & React.RefAttributes<HTMLDivElement>>;
export type SheetFooterProps = React.HTMLAttributes<HTMLDivElement>;
export declare const SheetFooter: React.ForwardRefExoticComponent<SheetFooterProps & React.RefAttributes<HTMLDivElement>>;
export type SheetTitleProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>;
export declare const SheetTitle: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogTitleProps & React.RefAttributes<HTMLHeadingElement>, "ref"> & React.RefAttributes<HTMLHeadingElement>>;
export type SheetDescriptionProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>;
export declare const SheetDescription: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogDescriptionProps & React.RefAttributes<HTMLParagraphElement>, "ref"> & React.RefAttributes<HTMLParagraphElement>>;
export {};
