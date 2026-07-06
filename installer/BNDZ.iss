; BNDZ Windows Installer (Inno Setup 6)

; Build: ISCC.exe installer\BNDZ.iss /DPublishDir=path\to\publish\win-x64



#ifndef PublishDir

  #define PublishDir "..\dist\publish\win-x64"

#endif



#ifndef MyAppVersion

  #define MyAppVersion "1.0.0"

#endif



#ifndef SourcePath

  #define SourcePath ".."

#endif



#define MyAppName "BNDZ"

#define MyAppPublisher "BNDZ"

#define MyAppExeName "BNDZ.exe"

#define MyAppURL "https://github.com/bndz"

#define WebView2Bootstrapper "installer\redist\MicrosoftEdgeWebview2Setup.exe"



[Setup]

AppId={{A7B3E4F1-9C2D-4B8A-BNDZ-36200001}

AppName={#MyAppName}

AppVersion={#MyAppVersion}

AppPublisher={#MyAppPublisher}

AppPublisherURL={#MyAppURL}

DefaultDirName={autopf}\{#MyAppName}

DefaultGroupName={#MyAppName}

DisableProgramGroupPage=yes

OutputDir=..\dist

OutputBaseFilename=BNDZ-Setup-{#MyAppVersion}

Compression=lzma2/ultra64

SolidCompression=yes

WizardStyle=modern

LicenseFile={#SourcePath}\docs\EULA.md

PrivilegesRequired=lowest

ArchitecturesAllowed=x64compatible

ArchitecturesInstallIn64BitMode=x64compatible

UninstallDisplayIcon={app}\{#MyAppExeName}

SetupIconFile=..\BNDZBackend\Assets\BNDZ.ico

VersionInfoVersion={#MyAppVersion}.0

ChangesAssociations=no



[Languages]

Name: "english"; MessagesFile: "compiler:Default.isl"



[Tasks]

Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

Name: "quicklaunchicon"; Description: "{cm:CreateQuickLaunchIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked; OnlyBelowVersion: 6.1



[Files]

Source: "{#PublishDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

Source: "{#SourcePath}\{#WebView2Bootstrapper}"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2



[Icons]

Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"

Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"

Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

Name: "{userappdata}\Microsoft\Internet Explorer\Quick Launch\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: quicklaunchicon



[Run]

Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; StatusMsg: "Installing Microsoft Edge WebView2 Runtime..."; Check: NeedsWebView2; Flags: waituntilterminated

Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent



[Code]

function IsWebView2Installed: Boolean;

var

  Version: String;

begin

  Result :=

    RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7CC4C}', 'pv', Version) or

    RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7CC4C}', 'pv', Version) or

    RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7CC4C}', 'pv', Version);

end;



function NeedsWebView2: Boolean;

begin

  Result := not IsWebView2Installed;

end;



function InitializeSetup: Boolean;

begin

  Result := True;

end;



function InitializeUninstall: Boolean;

begin

  Result := True;

end;



procedure DeinitializeSetup();

begin

  if not IsWebView2Installed then

    MsgBox('Microsoft Edge WebView2 Runtime could not be verified after setup.' + #13#10 + #13#10 +

      'BNDZ requires WebView2 to display its interface. Please install WebView2 from Microsoft and restart BNDZ.',

      mbError, MB_OK);

end;


