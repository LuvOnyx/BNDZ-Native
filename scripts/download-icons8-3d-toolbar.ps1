# Downloads Icons8 3D Fluency PNGs for BNDZ toolbar + configurator.
# Source: https://icons8.com/icons/all--technique-3d (free with attribution)
param([string]$Root = "", [int]$Size = 48)

$ErrorActionPreference = "Stop"
if (-not $Root) {
    $Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
}

$dest = Join-Path $Root "public\launcher-icons"
New-Item -ItemType Directory -Path $dest -Force | Out-Null

# toolbar id -> Icons8 3d-fluency slug
$map = @{
    nav_back = 'arrow-left'
    nav_forward = 'arrow-right'
    nav_up = 'arrow-up'
    go_home = 'home'
    refresh = 'refresh'
    folder_size_sync = 'synchronize'
    go_recycle_bin = 'trash-can'
    go_network = 'globe'
    new_tab = 'add-file'
    cut = 'cut'
    copy = 'documents'
    paste = 'paste'
    delete = 'trash'
    undo = 'undo'
    redo = 'redo'
    select_all = 'checkmark'
    invert_selection = 'synchronize'
    copy_path = 'path'
    new_folder = 'add-folder'
    new_file = 'add-file'
    compress = 'archive'
    extract = 'archive'
    properties = 'info'
    sync_folders = 'synchronize'
    map_network_drive = 'globe'
    share = 'link'
    burn_disc = 'cd'
    view_details = 'view'
    view_grid = 'view'
    view_list = 'table'
    search = 'search'
    toggle_dual_pane = 'table'
    toggle_preview = 'eye'
    toggle_bottom = 'stack'
    smart_tools = 'sparkles'
    tag_manager = 'price-tag'
    icon_studio = 'color-palette'
    find = 'magnifying-glass'
    dropstack = 'stack'
    filters = 'filter'
    batch_rename = 'edit'
    shell_menus = 'menu'
    metadata = 'database'
    storage_cleanup = 'broom'
    sys_properties = 'information'
    config = 'gear'
    extension_hub = 'puzzle'
    wrench = 'wrench'
    cmd = 'command-line'
    ps = 'code'
    terminal_here = 'console'
    taskmgr = 'processor'
    regedit = 'database'
    control_panel = 'control-panel'
    settings_app = 'windows-10'
    device_manager = 'device-manager'
    services = 'services'
    event_viewer = 'book'
    disk_mgmt = 'hdd'
    computer_mgmt = 'monitor'
    sysdm_cpl = 'information'
    network_connections = 'wifi'
    printers = 'print'
    programs_features = 'shop'
    firewall = 'firewall'
    power_options = 'battery'
    user_accounts = 'group'
    msinfo = 'information'
    dxdiag = 'joystick'
    notepad = 'notepad'
    calc = 'calculator'
    paint = 'paint-brush'
    snipping_tool = 'camera'
    explorer = 'opened-folder'
    magnifier = 'magnifying-glass'
    osk = 'keyboard'
    bookmark = 'bookmark'
    link = 'link'
    store = 'shop'
    theme = 'color-palette'
    keyboard_settings = 'keyboard'
    clipboard = 'paste'
    snippet = 'note'
    plugin = 'plugin'
    plugins = 'puzzle'
    zip = 'archive'
    recycle = 'trash-can'
    network = 'globe'
    terminal = 'command-line'
    powershell = 'code'
    calculator = 'calculator'
}

$base = "https://img.icons8.com/3d-fluency/$Size"
$ok = 0
$fail = 0

foreach ($pair in $map.GetEnumerator()) {
    $out = Join-Path $dest "$($pair.Key).png"
    $url = "$base/$($pair.Value).png"
    try {
        Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 20
        $ok++
    }
    catch {
        Write-Warning "Failed $($pair.Key) <- $($pair.Value)"
        $fail++
    }
}

Write-Host "==> Icons8 3D toolbar icons: $ok ok, $fail failed -> $dest" -ForegroundColor Green
