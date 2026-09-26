import * as React from "react"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline"
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  let baseClass = "inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
  
  let variantClass = "border-transparent bg-primary text-primary-foreground shadow hover:bg-primary/80"
  if (variant === "secondary") variantClass = "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80"
  else if (variant === "destructive") variantClass = "border-transparent bg-destructive text-destructive-foreground shadow hover:bg-destructive/80"
  else if (variant === "outline") variantClass = "text-foreground"

  return (
    <div className={`${baseClass} ${variantClass} ${className || ''}`} {...props} />
  )
}
