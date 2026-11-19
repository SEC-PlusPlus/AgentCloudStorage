// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import { type VariantProps } from "class-variance-authority";
declare const alertDialogContentVariants: (props?: ({
    variant?: "default" | "glass" | "matte" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
declare const alertDialogActionVariants: (props?: ({
    variant?: "default" | "glass" | "matte" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export declare const AlertDialog: React.FC<AlertDialogPrimitive.AlertDialogProps>;
export declare const AlertDialogTrigger: React.ForwardRefExoticComponent<AlertDialogPrimitive.AlertDialogTriggerProps & React.RefAttributes<HTMLButtonElement>>;
export declare const AlertDialogPortal: React.FC<AlertDialogPrimitive.AlertDialogPortalProps>;
export declare const AlertDialogOverlay: React.ForwardRefExoticComponent<Omit<AlertDialogPrimitive.AlertDialogOverlayProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
export type AlertDialogContentProps = React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content> & VariantProps<typeof alertDialogContentVariants>;
export declare const AlertDialogContent: React.ForwardRefExoticComponent<Omit<AlertDialogPrimitive.AlertDialogContentProps & React.RefAttributes<HTMLDivElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "matte" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLDivElement>>;
export declare const AlertDialogHeader: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => import("react/jsx-runtime").JSX.Element;
export declare const AlertDialogFooter: ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => import("react/jsx-runtime").JSX.Element;
export declare const AlertDialogTitle: React.ForwardRefExoticComponent<Omit<AlertDialogPrimitive.AlertDialogTitleProps & React.RefAttributes<HTMLHeadingElement>, "ref"> & React.RefAttributes<HTMLHeadingElement>>;
export declare const AlertDialogDescription: React.ForwardRefExoticComponent<Omit<AlertDialogPrimitive.AlertDialogDescriptionProps & React.RefAttributes<HTMLParagraphElement>, "ref"> & React.RefAttributes<HTMLParagraphElement>>;
export type AlertDialogActionProps = React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action> & VariantProps<typeof alertDialogActionVariants>;
export declare const AlertDialogAction: React.ForwardRefExoticComponent<Omit<AlertDialogPrimitive.AlertDialogActionProps & React.RefAttributes<HTMLButtonElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "matte" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLButtonElement>>;
export declare const AlertDialogCancel: React.ForwardRefExoticComponent<Omit<AlertDialogPrimitive.AlertDialogCancelProps & React.RefAttributes<HTMLButtonElement>, "ref"> & React.RefAttributes<HTMLButtonElement>>;
export {};
