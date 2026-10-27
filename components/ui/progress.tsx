import * as React from "react"

export interface ProgressProps extends React.HTMLAttributes<HTMLDivElement> {
  value?: number
}

export function Progress({ className, value = 0, ...props }: ProgressProps) {
  return (
    <div
      className={`relative h-2 w-full overflow-hidden rounded-full bg-gray-200 ${className || ''}`}
      {...props}
    >
      <div
        className="h-full rounded-full bg-trust-600 transition-all duration-300 ease-in-out"
        style={{ width: `${value || 0}%` }}
      />
    </div>
  )
}
