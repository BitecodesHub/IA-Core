import React, { useEffect } from "react"
import { IoLogOutOutline } from "react-icons/io5"

interface SolutionCommandsProps {
  extraScreenshots: any[]
  /** Optional; kept for parent height-sync compatibility. No tooltip is shown. */
  onTooltipVisibilityChange?: (visible: boolean, height: number) => void
}

const KeyChip: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span className="bg-white/10 rounded-md px-1.5 py-1 text-[11px] leading-none text-white/70">
    {children}
  </span>
)

const SolutionCommands: React.FC<SolutionCommandsProps> = ({
  extraScreenshots,
  onTooltipVisibilityChange,
}) => {
  // No tooltip anymore — reset any parent height reservation once on mount.
  useEffect(() => {
    onTooltipVisibilityChange?.(false, 0)
  }, [onTooltipVisibilityChange])

  return (
    <div className="pt-2 w-fit">
      <div className="text-xs text-white/90 backdrop-blur-md bg-black/60 rounded-lg py-2 px-4 flex items-center justify-center gap-4">
        {/* Screenshot */}
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-[11px] leading-none truncate">
            {extraScreenshots.length === 0 ? "Screenshot your code" : "Screenshot"}
          </span>
          <div className="flex gap-1">
            <KeyChip>⌘</KeyChip>
            <KeyChip>H</KeyChip>
          </div>
        </div>

        {extraScreenshots.length > 0 && (
          <div className="flex items-center gap-2 whitespace-nowrap">
            <span className="text-[11px] leading-none">Debug</span>
            <div className="flex gap-1">
              <KeyChip>⌘</KeyChip>
              <KeyChip>↵</KeyChip>
            </div>
          </div>
        )}

        {/* Start Over */}
        <div className="flex items-center gap-2 whitespace-nowrap">
          <span className="text-[11px] leading-none">Start over</span>
          <div className="flex gap-1">
            <KeyChip>⌘</KeyChip>
            <KeyChip>R</KeyChip>
          </div>
        </div>

        {/* Quit */}
        <button
          className="text-white/70 hover:text-red-400 transition-colors hover:cursor-pointer"
          title="Quit"
          aria-label="Quit"
          onClick={() => window.electronAPI.quitApp()}
        >
          <IoLogOutOutline className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

export default SolutionCommands
