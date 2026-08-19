!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var StartWithWindowsCheckbox
Var StartWithWindowsState

!macro customHeader
  Page custom StartWithWindowsPage StartWithWindowsPageLeave
!macroend

Function StartWithWindowsPage
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}

  ${NSD_CreateLabel} 0 0 100% 28u "Background startup"
  Pop $0
  CreateFont $1 "$(^Font)" "12" "700"
  SendMessage $0 ${WM_SETFONT} $1 1

  ${NSD_CreateLabel} 0 34u 100% 30u "Anime Relay can start automatically when you sign in, already minimized to the system tray."
  Pop $0

  ${NSD_CreateCheckbox} 0 76u 100% 14u "Start Anime Relay with Windows (minimized)"
  Pop $StartWithWindowsCheckbox

  ReadRegStr $0 HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Anime Relay"
  ${If} $0 != ""
    ${NSD_Check} $StartWithWindowsCheckbox
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function StartWithWindowsPageLeave
  ${NSD_GetState} $StartWithWindowsCheckbox $StartWithWindowsState
FunctionEnd

!macro customInstall
  ${If} $StartWithWindowsState == ${BST_CHECKED}
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Anime Relay" '$\"$INSTDIR\Anime Relay.exe$\" --hidden'
  ${Else}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Anime Relay"
  ${EndIf}
!macroend

!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Anime Relay"
!macroend
