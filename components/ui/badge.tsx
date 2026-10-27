import * as React from "react"

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "secondary" | "destructive" | "outline"
}

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  let baseClass = "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-trust-500/40 focus:ring-offset-2"
  
  let variantClass = "border-transparent bg-trust-600 text-white"
  if (variant === "secondary") variantClass = "border-gray-200 bg-gray-100 text-gray-700"
  else if (variant === "destructive") variantClass = "border-red-200 bg-red-50 text-red-700"
  else if (variant === "outline") variantClass = "border-gray-300 bg-white text-gray-700"

  return (
    <div className={`${baseClass} ${variantClass} ${className || ''}`} {...props} />
  )
}
