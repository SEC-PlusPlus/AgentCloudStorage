// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cva } from "class-variance-authority";
import { cn } from "../lib/cn";
const dropdownMenuTriggerVariants = cva("inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50", {
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
const dropdownMenuContentVariants = cva("z-50 min-w-44 rounded-md border p-1 text-[var(--color-foreground)] shadow-md", {
    variants: {
        variant: {
            default: "bg-[var(--color-surface)] border-[var(--color-border)]",
            glass: "backdrop-blur-xl backdrop-saturate-[180%] bg-[var(--glass-3-surface)] border border-white/20 [border-top-color:var(--glass-refraction-top)] shadow-[0_0_0_1px_rgb(255_255_255_/_0.1)_inset,var(--shadow-glass-sm)] dark:border-white/[0.1] dark:shadow-[0_0_0_1px_rgb(255_255_255_/_0.05)_inset,0_8px_24px_rgb(0_0_0_/_0.35)]",
            frosted: "backdrop-blur-[40px] backdrop-saturate-[200%] bg-[var(--glass-4-surface)] border border-white/30 [border-top-color:var(--glass-refraction-top)] shadow-[0_0_0_1px_rgb(255_255_255_/_0.15)_inset,0_0_16px_rgb(255_255_255_/_0.1)_inset,var(--shadow-glass-md)] dark:border-white/[0.14] dark:shadow-[0_0_0_1px_rgb(255_255_255_/_0.07)_inset,0_0_16px_rgb(255_255_255_/_0.03)_inset,0_8px_24px_rgb(0_0_0_/_0.4)]",
            outline: "bg-transparent border-[var(--color-border)]",
            ghost: "bg-transparent border-transparent"
        },
        size: {
            sm: "text-xs",
            md: "text-sm",
            lg: "text-base"
        }
    },
    defaultVariants: {
        variant: "default",
        size: "md"
    }
});
const dropdownMenuItemVariants = cva("relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 outline-none transition-colors focus:bg-black/5 focus:text-[var(--color-foreground)] dark:focus:bg-black/50 data-[highlighted]:bg-black/5 data-[highlighted]:text-[var(--color-foreground)] dark:data-[highlighted]:bg-black/50 data-[disabled]:pointer-events-none data-[disabled]:opacity-50", {
    variants: {
        variant: {
            default: "",
            glass: "",
            frosted: "",
            outline: "",
            ghost: ""
        },
        size: {
            sm: "text-xs",
            md: "text-sm",
            lg: "text-base"
        }
    },
    defaultVariants: {
        variant: "default",
        size: "md"
    }
});
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = React.forwardRef(({ className, variant, size, ...props }, ref) => (_jsx(DropdownMenuPrimitive.Trigger, { ref: ref, className: cn(dropdownMenuTriggerVariants({ variant, size }), className), ...props })));
DropdownMenuTrigger.displayName = DropdownMenuPrimitive.Trigger.displayName;
export const DropdownMenuContent = React.forwardRef(({ className, sideOffset = 6, variant, size, ...props }, ref) => (_jsx(DropdownMenuPrimitive.Portal, { children: _jsx(DropdownMenuPrimitive.Content, { ref: ref, sideOffset: sideOffset, className: cn(dropdownMenuContentVariants({ variant, size }), className), ...props }) })));
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;
export const DropdownMenuItem = React.forwardRef(({ className, inset, variant, size, ...props }, ref) => (_jsx(DropdownMenuPrimitive.Item, { ref: ref, className: cn(dropdownMenuItemVariants({ variant, size }), inset ? "pl-8" : "", className), ...props })));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;
export const DropdownMenuCheckboxItem = React.forwardRef(({ className, children, checked, variant, size, ...props }, ref) => (_jsxs(DropdownMenuPrimitive.CheckboxItem, { ref: ref, className: cn(dropdownMenuItemVariants({ variant, size }), "pl-8", className), checked: checked, ...props, children: [_jsx("span", { className: "absolute left-2 flex h-3.5 w-3.5 items-center justify-center", children: _jsx(DropdownMenuPrimitive.ItemIndicator, { children: _jsx(Check, { className: "h-4 w-4" }) }) }), children] })));
DropdownMenuCheckboxItem.displayName = DropdownMenuPrimitive.CheckboxItem.displayName;
export const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;
export const DropdownMenuRadioItem = React.forwardRef(({ className, children, variant, size, ...props }, ref) => (_jsxs(DropdownMenuPrimitive.RadioItem, { ref: ref, className: cn(dropdownMenuItemVariants({ variant, size }), "pl-8", className), ...props, children: [_jsx("span", { className: "absolute left-2 flex h-3.5 w-3.5 items-center justify-center", children: _jsx(DropdownMenuPrimitive.ItemIndicator, { children: _jsx(Circle, { className: "h-2.5 w-2.5 fill-current" }) }) }), children] })));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;
export const DropdownMenuLabel = React.forwardRef(({ className, inset, ...props }, ref) => (_jsx(DropdownMenuPrimitive.Label, { ref: ref, className: cn("px-2 py-1.5 text-sm font-semibold", inset && "pl-8", className), ...props })));
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName;
export const DropdownMenuSeparator = React.forwardRef(({ className, ...props }, ref) => (_jsx(DropdownMenuPrimitive.Separator, { ref: ref, className: cn("my-1 h-px bg-[var(--color-border)]", className), ...props })));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;
export const DropdownMenuShortcut = ({ className, ...props }) => {
    return _jsx("span", { className: cn("ml-auto text-xs tracking-widest opacity-60", className), ...props });
};
export const DropdownMenuSub = DropdownMenuPrimitive.Sub;
export const DropdownMenuSubTrigger = React.forwardRef(({ className, inset, children, variant, size, ...props }, ref) => (_jsxs(DropdownMenuPrimitive.SubTrigger, { ref: ref, className: cn(dropdownMenuItemVariants({ variant, size }), inset && "pl-8", className), ...props, children: [children, _jsx(ChevronRight, { className: "ml-auto h-4 w-4" })] })));
DropdownMenuSubTrigger.displayName = DropdownMenuPrimitive.SubTrigger.displayName;
export const DropdownMenuSubContent = React.forwardRef(({ className, variant, size, ...props }, ref) => (_jsx(DropdownMenuPrimitive.SubContent, { ref: ref, className: cn(dropdownMenuContentVariants({ variant, size }), className), ...props })));
DropdownMenuSubContent.displayName = DropdownMenuPrimitive.SubContent.displayName;
