import * as React from "react";
import { cn } from "@/lib/utils";

type CcsLogoProps = React.ComponentPropsWithoutRef<"img"> & {
  size?: "small" | "medium" | "large";
};

const sizeClasses: Record<NonNullable<CcsLogoProps["size"]>, string> = {
  small: "w-8 h-8",
  medium: "w-12 h-12",
  large: "w-20 h-20 md:w-24 md:h-24",
};

export function CcsLogo({ className, size = "medium", ...props }: CcsLogoProps) {
  return (
    <img
      src="/images/ccs.png"
      alt="CCS logo"
      className={cn("select-none", sizeClasses[size], className)}
      {...props}
    />
  );
}
