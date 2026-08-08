# Workaround for WinUI XamlCompiler WMC9999 with `dotnet build` (Core MSBuild).
# XamlCompiler.exe looks for Microsoft.UI.Xaml.Markup.Compiler.ErrorMessages.resources
# but ships Microsoft.Windows.UI.Xaml.Build.Tasks.ErrorMessages.resources only.
# See: https://github.com/microsoft/microsoft-ui-xaml/issues/11157
#
# Safe / idempotent: adds the expected resource name as a duplicate embed if missing.

$ErrorActionPreference = "Stop"

$winui = Join-Path $env:USERPROFILE ".nuget\packages\microsoft.windowsappsdk.winui"
if (-not (Test-Path $winui)) {
  Write-Host "WinUI package cache not found; skip XamlCompiler patch."
  exit 0
}

$exes = Get-ChildItem -Path $winui -Recurse -Filter "XamlCompiler.exe" -ErrorAction SilentlyContinue |
  Where-Object { $_.DirectoryName -match '\\tools\\net472$' }

if (-not $exes) {
  Write-Host "No XamlCompiler.exe under microsoft.windowsappsdk.winui; skip."
  exit 0
}

$toolDir = Join-Path $env:TEMP "bndz-xaml-patch"
New-Item -ItemType Directory -Force -Path $toolDir | Out-Null
$proj = Join-Path $toolDir "XamlPatch.csproj"
$prog = Join-Path $toolDir "Program.cs"

@'
<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <OutputType>Exe</OutputType>
    <TargetFramework>net10.0</TargetFramework>
    <ImplicitUsings>enable</ImplicitUsings>
    <Nullable>enable</Nullable>
  </PropertyGroup>
  <ItemGroup>
    <PackageReference Include="Mono.Cecil" Version="0.11.6" />
  </ItemGroup>
</Project>
'@ | Set-Content -Path $proj -Encoding UTF8

@'
using Mono.Cecil;

if (args.Length < 1) { Console.Error.WriteLine("Usage: XamlPatch <XamlCompiler.exe>"); return 1; }
var path = args[0];
var bak = path + ".bak";
if (!File.Exists(bak)) File.Copy(path, bak, overwrite: false);

var resolver = new DefaultAssemblyResolver();
resolver.AddSearchDirectory(Path.GetDirectoryName(path)!);
var rp = new ReaderParameters { AssemblyResolver = resolver, ReadWrite = true };
using var module = ModuleDefinition.ReadModule(path, rp);

const string oldName = "Microsoft.Windows.UI.Xaml.Build.Tasks.ErrorMessages.resources";
const string newName = "Microsoft.UI.Xaml.Markup.Compiler.ErrorMessages.resources";

if (module.Resources.OfType<EmbeddedResource>().Any(r => r.Name == newName))
{
    Console.WriteLine("OK (already patched): " + path);
    return 0;
}

var old = module.Resources.OfType<EmbeddedResource>().FirstOrDefault(r => r.Name == oldName);
if (old is null)
{
    Console.Error.WriteLine("Missing source resource in " + path);
    foreach (var r in module.Resources) Console.Error.WriteLine("  " + r.Name);
    return 2;
}

byte[] data;
using (var s = old.GetResourceStream())
using (var ms = new MemoryStream())
{
    s.CopyTo(ms);
    data = ms.ToArray();
}

module.Resources.Add(new EmbeddedResource(newName, ManifestResourceAttributes.Public, data));
module.Write();
Console.WriteLine("Patched: " + path);
return 0;
'@ | Set-Content -Path $prog -Encoding UTF8

foreach ($exe in $exes) {
  Write-Host "==> Patching $($exe.FullName)"
  dotnet run --project $proj -c Release --no-launch-profile -- $exe.FullName
  if ($LASTEXITCODE -ne 0) { throw "XamlCompiler patch failed for $($exe.FullName)" }
}
