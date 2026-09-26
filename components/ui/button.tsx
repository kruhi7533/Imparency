import * as React from "react"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  size?: "default" | "sm" | "lg" | "icon"
}

export function Button({ className, variant = "default", size = "default", ...props }: ButtonProps) {
  let baseClass = "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
  
  let variantClass = "bg-primary text-primary-foreground shadow hover:bg-primary/90"
  if (variant === "destructive") variantClass = "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90"
  else if (variant === "outline") variantClass = "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground"
  else if (variant === "secondary") variantClass = "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80"
  else if (variant === "ghost") variantClass = "hover:bg-accent hover:text-accent-foreground"
  else if (variant === "link") variantClass = "text-primary underline-offset-4 hover:underline"
  
  let sizeClass = "h-9 px-4 py-2"
  if (size === "sm") sizeClass = "h-8 rounded-md px-3 text-xs"
  else if (size === "lg") sizeClass = "h-10 rounded-md px-8"
  else if (size === "icon") sizeClass = "h-9 w-9"

  return (
    <button
      className={`${baseClass} ${variantClass} ${sizeClass} ${className || ''}`}
      {...props}
    />
  )
}
