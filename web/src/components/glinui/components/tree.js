// vendored from @glinui/ui@0.1.1 dist (COMPILED — registry-swap-pending) @2026-11-19
"use client";
import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import * as React from "react";
import { cva } from "class-variance-authority";
import { ChevronRight, Folder, FolderOpen, FileText } from "lucide-react";
import { cn } from "../lib/cn";
/* ── Variants ──────────────────────────────────────────────────────────── */
const treeVariants = cva("w-full rounded-lg border text-sm", {
    variants: {
        variant: {
            default: "border-border/60 bg-[var(--color-surface)]",
            glass: "backdrop-blur-md border-white/10 bg-[var(--glass-1-surface)]",
            outline: "border-border/60 bg-transparent",
            ghost: "border-transparent bg-transparent"
        }
    },
    defaultVariants: {
        variant: "default"
    }
});
/* ── TreeNodeItem (recursive) ──────────────────────────────────────────── */
const badgeColors = {
    default: "bg-neutral-100/60 text-neutral-600 dark:bg-white/[0.06] dark:text-neutral-400",
    success: "bg-emerald-100/60 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
    warning: "bg-amber-100/60 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
    info: "bg-blue-100/60 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
    destructive: "bg-red-100/60 text-red-700 dark:bg-red-900/30 dark:text-red-400"
};
function TreeNodeItem({ node, depth, defaultExpanded }) {
    const isFolder = node.children && node.children.length > 0;
    const [expanded, setExpanded] = React.useState(defaultExpanded);
    const paddingLeft = 12 + depth * 16;
    const content = (_jsxs(_Fragment, { children: [isFolder ? (_jsx("span", { className: "text-neutral-400 dark:text-neutral-500", children: expanded ? _jsx(FolderOpen, { className: "size-4" }) : _jsx(Folder, { className: "size-4" }) })) : (_jsx("span", { className: "text-neutral-400 dark:text-neutral-500", children: node.icon ?? _jsx(FileText, { className: "size-3.5" }) })), _jsx("span", { className: cn("truncate", isFolder ? "font-medium text-foreground" : "font-mono text-neutral-700 dark:text-neutral-300"), children: node.label }), node.badge && (_jsx("span", { className: cn("ml-auto shrink-0 rounded-md border border-current/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider", badgeColors[node.badgeVariant ?? "default"]), children: node.badge }))] }));
    if (isFolder) {
        return (_jsxs("div", { children: [_jsxs("button", { type: "button", onClick: () => setExpanded(!expanded), className: "flex w-full items-center gap-2 py-1.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]", style: { paddingLeft }, children: [_jsx(ChevronRight, { className: cn("size-3 shrink-0 text-neutral-400 transition-transform duration-150", expanded && "rotate-90") }), content] }), expanded && (_jsx("div", { children: node.children.map((child, i) => (_jsx(TreeNodeItem, { node: child, depth: depth + 1, defaultExpanded: defaultExpanded }, `${child.label}-${i}`))) }))] }));
    }
    const sharedClassName = "flex w-full items-center gap-2 py-1.5 transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.03]";
    if (node.href) {
        return (_jsx("a", { href: node.href, target: node.external ? "_blank" : undefined, rel: node.external ? "noopener noreferrer" : undefined, className: sharedClassName, style: { paddingLeft: paddingLeft + 15 }, children: content }));
    }
    return (_jsx("div", { className: sharedClassName, style: { paddingLeft: paddingLeft + 15 }, children: content }));
}
/* ── Tree ──────────────────────────────────────────────────────────────── */
export const Tree = React.forwardRef(({ className, variant, nodes, defaultExpanded = true, ...props }, ref) => {
    return (_jsx("div", { ref: ref, className: cn(treeVariants({ variant }), className), ...props, children: _jsx("div", { className: "py-1", children: nodes.map((node, i) => (_jsx(TreeNodeItem, { node: node, depth: 0, defaultExpanded: defaultExpanded }, `${node.label}-${i}`))) }) }));
});
Tree.displayName = "Tree";
/* ── Utility: build tree from flat file paths ─────────────────────────── */
export function buildFileTree(paths, options) {
    const root = { label: "", children: [] };
    for (const filePath of paths) {
        const parts = filePath.split("/");
        let current = root;
        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const isLeaf = i === parts.length - 1;
            if (isLeaf) {
                const badgeInfo = options?.getBadge?.(filePath);
                current.children.push({
                    label: part,
                    href: options?.hrefPrefix ? `${options.hrefPrefix}/${filePath}` : undefined,
                    external: !!options?.hrefPrefix,
                    ...(badgeInfo ?? {})
                });
            }
            else {
                let folder = current.children.find((c) => c.label === part && c.children);
                if (!folder) {
                    folder = { label: part, children: [] };
                    current.children.push(folder);
                }
                current = folder;
            }
        }
    }
    return root.children;
}
