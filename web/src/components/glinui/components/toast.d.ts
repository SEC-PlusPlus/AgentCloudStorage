// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { type VariantProps } from "class-variance-authority";
export declare const ToastProvider: React.FC<ToastPrimitives.ToastProviderProps>;
declare const toastVariants: (props?: ({
    variant?: "default" | "glass" | "frosted" | "matte" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type ToastViewportProps = React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>;
export declare const ToastViewport: React.ForwardRefExoticComponent<Omit<ToastPrimitives.ToastViewportProps & React.RefAttributes<HTMLOListElement>, "ref"> & React.RefAttributes<HTMLOListElement>>;
export type ToastProps = React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & VariantProps<typeof toastVariants>;
export declare const Toast: React.ForwardRefExoticComponent<Omit<ToastPrimitives.ToastProps & React.RefAttributes<HTMLLIElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "matte" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLLIElement>>;
export type ToastTitleProps = React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>;
export declare const ToastTitle: React.ForwardRefExoticComponent<Omit<ToastPrimitives.ToastTitleProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
export type ToastDescriptionProps = React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>;
export declare const ToastDescription: React.ForwardRefExoticComponent<Omit<ToastPrimitives.ToastDescriptionProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
export type ToastCloseProps = React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>;
export declare const ToastClose: React.ForwardRefExoticComponent<Omit<ToastPrimitives.ToastCloseProps & React.RefAttributes<HTMLButtonElement>, "ref"> & React.RefAttributes<HTMLButtonElement>>;
export {};
