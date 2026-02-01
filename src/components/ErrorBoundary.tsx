import React, { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
  fallback?: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo)
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback
      }

      return (
        <div className="flex items-center justify-center min-h-screen bg-black text-white p-4">
          <div className="max-w-md w-full bg-black border-2 border-red-500 rounded-lg p-6">
            <h2 className="text-xl font-bold text-red-500 mb-4">⚠️ Something went wrong</h2>
            <p className="text-sm text-white/80 mb-4">
              The application encountered an unexpected error. Please try refreshing or restarting the app.
            </p>
            {this.state.error && (
              <details className="mb-4">
                <summary className="text-xs text-white/60 cursor-pointer hover:text-white/80">
                  Error details
                </summary>
                <pre className="text-xs text-red-400 mt-2 p-2 bg-black/50 rounded overflow-auto max-h-40">
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
            <button
              onClick={this.handleReset}
              className="w-full bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-lg transition-colors"
            >
              Try Again
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
