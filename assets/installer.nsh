; Custom NSIS hooks for the Notes installer (auto-included by electron-builder
; from buildResources).

; --- First-install crash fix -------------------------------------------------
; On a first install (no InstallLocation recorded yet) electron-builder's
; setInstallModePerUser asks SHGetKnownFolderPath for the per-user Programs
; folder and copies the result with
;     System::Call '*$2(&w${NSIS_MAX_STRLEN} .s)'
; which reads NSIS_MAX_STRLEN characters from a buffer holding only the short
; path — a heap over-read that crashes the installer inside System.dll
; (0xC0000005) whenever it runs into unmapped memory: about 1 in 6–10 fresh
; installs in our x64 and ARM stress tests. Recording the standard location
; first makes the installer take its "previous installation" branch and skip
; that code. The folder is the same one electron-builder would pick:
; %LOCALAPPDATA%\Programs\<app>.
!macro preInit
  ; Not during the build-time run that only writes the uninstaller.
  !ifndef BUILD_UNINSTALLER
    ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation
    StrCmp $0 "" 0 notesInstallLocationKnown
      WriteRegStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "$LOCALAPPDATA\Programs\${APP_FILENAME}"
    notesInstallLocationKnown:
  !endif
!macroend

; --- App-running check --------------------------------------------------------
; Replaces electron-builder's default check, which first walks a Toolhelp
; process snapshot with raw System::Call struct reads (getProcessInfo.nsh).
; We only need "is Notes.exe running for this user? then close it", which
; tasklist/taskkill answer without any struct walking.
!macro customCheckAppRunning
  !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
  ${if} $R0 == 0
    MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(appRunning)" /SD IDOK IDOK notesCloseApp
    Quit
    notesCloseApp:
    DetailPrint `Closing running "${PRODUCT_NAME}"...`
    ; Ask nicely first, then force if it is still there.
    nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
    Pop $R0
    Sleep 1500
    !insertmacro FIND_PROCESS "${APP_EXECUTABLE_FILENAME}" $R0
    ${if} $R0 == 0
      nsExec::Exec `"$SYSDIR\cmd.exe" /c taskkill /f /t /im "${APP_EXECUTABLE_FILENAME}" /fi "USERNAME eq %USERNAME%"`
      Pop $R0
      Sleep 1000
    ${endIf}
  ${endIf}
!macroend
