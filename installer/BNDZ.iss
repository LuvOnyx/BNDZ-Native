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

{ Official Evergreen WebView2 Runtime client id (NOT the mistyped ...CC4C variant). }
const
  WebView2RuntimeId = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function IsValidWebView2Version(const Version: String): Boolean;
begin
  Result := (Trim(Version) <> '') and (Version <> '0.0.0.0');
end;

function HasWebView2Registry(const RootKey: Integer; const SubKey: String): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, SubKey, 'pv', Version) and IsValidWebView2Version(Version);
end;

function HasWebView2Files: Boolean;
var
  Base: String;
  FindRec: TFindRec;
begin
  Result := False;
  Base := ExpandConstant('{pf32}\Microsoft\EdgeWebView\Application');
  if DirExists(Base) and FindFirst(Base + '\*', FindRec) then
  begin
    try
      repeat
        if (FindRec.Attributes and FILE_ATTRIBUTE_DIRECTORY <> 0) and
           (FindRec.Name <> '.') and (FindRec.Name <> '..') and
           (FindRec.Name <> 'SetupMetrics') and
           FileExists(Base + '\' + FindRec.Name + '\msedgewebview2.exe') then
        begin
          Result := True;
          Break;
        end;
      until not FindNext(FindRec);
    finally
      FindClose(FindRec);
    end;
  end;
  if Result then
    Exit;
  { Also accept a direct evergreen layout if present under Program Files. }
  Result := FileExists(ExpandConstant('{pf}\Microsoft\EdgeWebView\Application\msedgewebview2.exe')) or
            FileExists(ExpandConstant('{localappdata}\Microsoft\EdgeWebView\Application\msedgewebview2.exe'));
end;

function IsWebView2Installed: Boolean;
begin
  { Prefer the Evergreen Runtime registry entries Microsoft documents. }
  Result :=
    HasWebView2Registry(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\' + WebView2RuntimeId) or
    HasWebView2Registry(HKLM, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WebView2RuntimeId) or
    HasWebView2Registry(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WebView2RuntimeId) or
    HasWebView2Registry(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\ClientState\' + WebView2RuntimeId) or
    HasWebView2Files;
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
  { Only warn when runtime is genuinely missing — UI already works if WebView2 is present. }
  if not IsWebView2Installed then
    MsgBox('Microsoft Edge WebView2 Runtime could not be verified after setup.' + #13#10 + #13#10 +
      'BNDZ requires WebView2 to display its interface. Please install WebView2 from Microsoft and restart BNDZ.',
      mbError, MB_OK);
end;


