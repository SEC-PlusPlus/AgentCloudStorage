// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { type VariantProps } from "class-variance-authority";
export type ModalProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>;
export declare const Modal: React.FC<DialogPrimitive.DialogProps>;
export declare const ModalTrigger: React.ForwardRefExoticComponent<DialogPrimitive.DialogTriggerProps & React.RefAttributes<HTMLButtonElement>>;
export declare const ModalClose: React.ForwardRefExoticComponent<DialogPrimitive.DialogCloseProps & React.RefAttributes<HTMLButtonElement>>;
export type ModalPortalProps = DialogPrimitive.DialogPortalProps;
export declare const ModalPortal: (props: ModalPortalProps) => import("react/jsx-runtime").JSX.Element;
declare const modalContentVariants: (props?: ({
    variant?: "default" | "glass" | "frosted" | "matte" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string;
export type ModalOverlayProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>;
export declare const ModalOverlay: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogOverlayProps & React.RefAttributes<HTMLDivElement>, "ref"> & React.RefAttributes<HTMLDivElement>>;
export type ModalContentProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & VariantProps<typeof modalContentVariants>;
export declare const ModalContent: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogContentProps & React.RefAttributes<HTMLDivElement>, "ref"> & VariantProps<(props?: ({
    variant?: "default" | "glass" | "frosted" | "matte" | null | undefined;
    size?: "sm" | "md" | "lg" | null | undefined;
} & import("class-variance-authority/types").ClassProp) | undefined) => string> & React.RefAttributes<HTMLDivElement>>;
export type ModalHeaderProps = React.HTMLAttributes<HTMLDivElement>;
export declare const ModalHeader: ({ className, ...props }: ModalHeaderProps) => import("react/jsx-runtime").JSX.Element;
export type ModalFooterProps = React.HTMLAttributes<HTMLDivElement>;
export declare const ModalFooter: ({ className, ...props }: ModalFooterProps) => import("react/jsx-runtime").JSX.Element;
export type ModalTitleProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>;
export declare const ModalTitle: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogTitleProps & React.RefAttributes<HTMLHeadingElement>, "ref"> & React.RefAttributes<HTMLHeadingElement>>;
export type ModalDescriptionProps = React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>;
export declare const ModalDescription: React.ForwardRefExoticComponent<Omit<DialogPrimitive.DialogDescriptionProps & React.RefAttributes<HTMLParagraphElement>, "ref"> & React.RefAttributes<HTMLParagraphElement>>;
export {};
