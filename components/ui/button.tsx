import * as React from "react"

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost" | "link"
  size?: "default" | "sm" | "lg" | "icon"
}

export function Button({ className, variant = "default", size = "default", ...props }: ButtonProps) {
  let baseClass = "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-trust-500/50 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
  
  let variantClass = "bg-trust-600 text-white shadow-sm hover:bg-trust-700"
  if (variant === "destructive") variantClass = "bg-red-600 text-white shadow-sm hover:bg-red-700"
  else if (variant === "outline") variantClass = "border border-gray-300 bg-white text-gray-800 shadow-sm hover:bg-gray-50"
  else if (variant === "secondary") variantClass = "bg-gray-100 text-gray-800 hover:bg-gray-200"
  else if (variant === "ghost") variantClass = "text-gray-700 hover:bg-gray-100 hover:text-gray-900"
  else if (variant === "link") variantClass = "text-trust-600 underline-offset-4 hover:text-trust-700 hover:underline"
  
  let sizeClass = "h-9 px-4 py-2"
  if (size === "sm") sizeClass = "h-8 rounded-lg px-3 text-xs"
  else if (size === "lg") sizeClass = "h-11 rounded-lg px-8"
  else if (size === "icon") sizeClass = "h-9 w-9"

  return (
    <button
      className={`${baseClass} ${variantClass} ${sizeClass} ${className || ''}`}
      {...props}
    />
  )
}
