; Custom NSIS hooks for the Notes installer (auto-included by electron-builder
; from buildResources).

; Replaces electron-builder's default "is the app running?" check.
;
; The default first calls ${GetProcessInfo}, which walks a Toolhelp process
; snapshot with raw System::Call struct reads. When processes start or exit
; during the walk it intermittently crashes the installer inside System.dll
; (0xC0000005, about 1 in 10 silent installs on busy machines). We only need
; "is Notes.exe running for this user? then close it", which tasklist/taskkill
; answer safely.
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
