// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
const sheetTriggerVariants = cva("inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50", {
    variants: {
        variant: {
            default: "bg-[var(--color-surface)] text-[var(--color-foreground)] border border-[var(--color-border)]",
            glass: "backdrop-blur-xl backdrop-saturate-[180%] bg-[var(--glass-3-surface)] border border-white/20 [border-top-color:var(--glass-refraction-top)] shadow-[0_0_0_1px_rgb(255_255_255_/_0.1)_inset,var(--shadow-glass-sm)] dark:border-white/[0.1] dark:shadow-[0_0_0_1px_rgb(255_255_255_/_0.05)_inset,0_8px_24px_rgb(0_0_0_/_0.35)] text-[var(--color-foreground)]",
            frosted: "backdrop-blur-[40px] backdrop-saturate-[200%] bg-[var(--glass-4-surface)] border border-white/30 [border-top-color:var(--glass-refraction-top)] shadow-[0_0_0_1px_rgb(255_255_255_/_0.15)_inset,0_0_16px_rgb(255_255_255_/_0.1)_inset,var(--shadow-glass-md)] dark:border-white/[0.14] dark:shadow-[0_0_0_1px_rgb(255_255_255_/_0.07)_inset,0_0_16px_rgb(255_255_255_/_0.03)_inset,0_8px_24px_rgb(0_0_0_/_0.4)] text-[var(--color-foreground)]",
            outline: "bg-transparent border border-[var(--color-border)] text-[var(--color-foreground)]",
            ghost: "bg-transparent border border-transparent text-[var(--color-foreground)]"
        },
        size: {
            sm: "h-8 px-3",
            md: "h-10 px-4",
            lg: "h-11 px-5"
        }
    },
    defaultVariants: {
        variant: "default",
        size: "md"
    }
});
const sheetContentVariants = cva("fixed z-50 border p-6 shadow-[var(--shadow-glass-md)] transition-transform duration-200 ease-out data-[state=closed]:opacity-0 data-[state=open]:opacity-100", {
    variants: {
        variant: {
            default: "bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-foreground)]",
            glass: "backdrop-blur-xl backdrop-saturate-[180%] bg-[var(--glass-3-surface)] border border-white/20 [border-top-color:var(--glass-refraction-top)] shadow-[0_0_0_1px_rgb(255_255_255_/_0.1)_inset,var(--shadow-glass-sm)] dark:border-white/[0.1] dark:shadow-[0_0_0_1px_rgb(255_255_255_/_0.05)_inset,0_8px_24px_rgb(0_0_0_/_0.35)] text-[var(--color-foreground)]",
            frosted: "backdrop-blur-[40px] backdrop-saturate-[200%] bg-[var(--glass-4-surface)] border border-white/30 [border-top-color:var(--glass-refraction-top)] shadow-[0_0_0_1px_rgb(255_255_255_/_0.15)_inset,0_0_20px_rgb(255_255_255_/_0.12)_inset,var(--shadow-glass-md)] dark:border-white/[0.14] dark:shadow-[0_0_0_1px_rgb(255_255_255_/_0.07)_inset,0_0_20px_rgb(255_255_255_/_0.04)_inset,0_8px_24px_rgb(0_0_0_/_0.4)] text-[var(--color-foreground)]",
            outline: "bg-transparent border-[var(--color-border)] text-[var(--color-foreground)]",
            ghost: "bg-transparent border-transparent text-[var(--color-foreground)]"
        },
        size: {
            sm: "",
            md: "",
            lg: ""
        },
        side: {
            top: "inset-x-0 top-0 border-b rounded-b-xl data-[state=closed]:-translate-y-full data-[state=open]:translate-y-0",
            bottom: "inset-x-0 bottom-0 border-t rounded-t-xl data-[state=closed]:translate-y-full data-[state=open]:translate-y-0",
            left: "inset-y-0 left-0 h-full border-r rounded-r-xl data-[state=closed]:-translate-x-full data-[state=open]:translate-x-0",
            right: "inset-y-0 right-0 h-full border-l rounded-l-xl data-[state=closed]:translate-x-full data-[state=open]:translate-x-0"
        }
    },
    compoundVariants: [
        { side: "left", size: "sm", className: "w-72" },
        { side: "left", size: "md", className: "w-96" },
        { side: "left", size: "lg", className: "w-[32rem]" },
        { side: "right", size: "sm", className: "w-72" },
        { side: "right", size: "md", className: "w-96" },
        { side: "right", size: "lg", className: "w-[32rem]" },
        { side: "top", size: "sm", className: "h-56" },
        { side: "top", size: "md", className: "h-72" },
        { side: "top", size: "lg", className: "h-80" },
        { side: "bottom", size: "sm", className: "h-56" },
        { side: "bottom", size: "md", className: "h-72" },
        { side: "bottom", size: "lg", className: "h-80" }
    ],
    defaultVariants: {
        variant: "default",
        size: "md",
        side: "right"
    }
});
export const Sheet = DialogPrimitive.Root;
export const Drawer = Sheet;
export const SheetTrigger = React.forwardRef(({ className, variant, size, ...props }, ref) => (_jsx(DialogPrimitive.Trigger, { ref: ref, className: cn(sheetTriggerVariants({ variant, size }), className), ...props })));
SheetTrigger.displayName = DialogPrimitive.Trigger.displayName;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = (props) => _jsx(DialogPrimitive.Portal, { ...props });
export const SheetOverlay = React.forwardRef(({ className, ...props }, ref) => (_jsx(DialogPrimitive.Overlay, { ref: ref, className: cn("fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-200 data-[state=closed]:opacity-0 data-[state=open]:opacity-100", className), ...props })));
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;
export const SheetContent = React.forwardRef(({ className, children, variant, size, side, ...props }, ref) => (_jsxs(SheetPortal, { children: [_jsx(SheetOverlay, {}), _jsxs(DialogPrimitive.Content, { ref: ref, className: cn(sheetContentVariants({ variant, size, side }), className), ...props, children: [children, _jsxs(DialogPrimitive.Close, { className: "absolute right-4 top-4 rounded-sm opacity-70 transition-opacity hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2", children: [_jsx(X, { className: "h-4 w-4" }), _jsx("span", { className: "sr-only", children: "Close" })] })] })] })));
SheetContent.displayName = DialogPrimitive.Content.displayName;
export const SheetHeader = React.forwardRef(({ className, ...props }, ref) => _jsx("div", { ref: ref, className: cn("flex flex-col space-y-1.5 text-left", className), ...props }));
SheetHeader.displayName = "SheetHeader";
export const SheetFooter = React.forwardRef(({ className, ...props }, ref) => (_jsx("div", { ref: ref, className: cn("mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className), ...props })));
SheetFooter.displayName = "SheetFooter";
export const SheetTitle = React.forwardRef(({ className, ...props }, ref) => (_jsx(DialogPrimitive.Title, { ref: ref, className: cn("text-lg font-semibold", className), ...props })));
SheetTitle.displayName = DialogPrimitive.Title.displayName;
export const SheetDescription = React.forwardRef(({ className, ...props }, ref) => (_jsx(DialogPrimitive.Description, { ref: ref, className: cn("text-sm text-neutral-600", className), ...props })));
SheetDescription.displayName = DialogPrimitive.Description.displayName;
