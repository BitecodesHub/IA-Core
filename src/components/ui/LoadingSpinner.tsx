import React from "react"

interface LoadingSpinnerProps {
  size?: "sm" | "md" | "lg"
  message?: string
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({ size = "md", message }) => {
  const sizeClasses = {
    sm: "w-4 h-4",
    md: "w-8 h-8",
    lg: "w-12 h-12",
  }

  return (
    <div className="flex flex-col items-center justify-center gap-3">
      <div
        className={`${sizeClasses[size]} border-2 border-white/20 border-t-white rounded-full animate-spin`}
      />
      {message && <p className="text-sm text-white/70">{message}</p>}
    </div>
  )
}

export default LoadingSpinner
