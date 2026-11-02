"use client";

import { DropdownMenu } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

/* Thin styled wrappers over Radix DropdownMenu (keyboard nav, focus, typeahead built in). */

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuRadioGroup = DropdownMenu.RadioGroup;

export function MenuContent({
  className,
  align = "start",
  sideOffset = 6,
  ...props
}: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-lg data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          className,
        )}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

const itemClass =
  "relative flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-surface-2 [&_svg]:size-4 [&_svg]:shrink-0";

export function MenuItem({ className, ...props }: ComponentProps<typeof DropdownMenu.Item>) {
  return <DropdownMenu.Item className={cn(itemClass, className)} {...props} />;
}

export function MenuRadioItem({
  className,
  children,
  ...props
}: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem className={cn(itemClass, "pr-8", className)} {...props}>
      {children}
      <DropdownMenu.ItemIndicator className="absolute right-2 inline-flex">
        <span aria-hidden="true" className="size-2 rounded-full bg-brand" />
      </DropdownMenu.ItemIndicator>
    </DropdownMenu.RadioItem>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return (
    <DropdownMenu.Label
      className={cn("px-2 pt-1.5 pb-1 text-xs font-medium text-muted-foreground", className)}
      {...props}
    />
  );
}

export function MenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={cn("my-1 h-px bg-border", className)} {...props} />;
}

/** Trigger styling shared by the workspace and brand switchers. */
export const switcherTriggerClass =
  "flex w-full items-center gap-2.5 rounded-lg border border-border bg-background px-2.5 py-2 text-left text-sm transition-colors hover:bg-surface-2 data-[state=open]:bg-surface-2";
