// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { cn } from "../lib/cn";
export const GlassBreadcrumb = React.forwardRef(({ className, items, separator = "/", maxItems, ...props }, ref) => {
    const visibleItems = React.useMemo(() => {
        if (!maxItems || items.length <= maxItems)
            return items;
        const first = items[0];
        const last = items.slice(-(maxItems - 1));
        return [first, { id: "__ellipsis__", label: "..." }, ...last];
    }, [items, maxItems]);
    return (_jsx("nav", { ref: ref, "aria-label": "Breadcrumb", className: cn("inline-flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-2 py-1 backdrop-blur-sm", className), ...props, children: _jsx("ol", { className: "flex items-center gap-1", children: visibleItems.map((item, index) => (_jsxs("li", { className: "flex items-center gap-1", children: [index > 0 && (_jsx("span", { "aria-hidden": "true", className: "text-xs text-foreground/30", children: separator })), item.id === "__ellipsis__" ? (_jsx("span", { className: "px-1 text-sm text-foreground/40", children: "..." })) : index === visibleItems.length - 1 ? (_jsx("span", { "aria-current": "page", className: "rounded-md bg-white/10 px-2 py-0.5 text-sm font-medium text-foreground backdrop-blur-sm", children: item.label })) : item.href ? (_jsx("a", { href: item.href, className: "rounded-md px-2 py-0.5 text-sm text-foreground/60 transition-colors duration-200 hover:bg-white/10 hover:text-foreground", onClick: item.onClick, children: item.label })) : (_jsx("button", { type: "button", className: "rounded-md px-2 py-0.5 text-sm text-foreground/60 transition-colors duration-200 hover:bg-white/10 hover:text-foreground", onClick: item.onClick, children: item.label }))] }, item.id))) }) }));
});
GlassBreadcrumb.displayName = "GlassBreadcrumb";
