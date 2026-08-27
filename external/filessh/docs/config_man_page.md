# NAME

`filessh-config` - configuration file for the `filessh` application.

# SYNOPSIS

The `filessh` configuration is managed through a TOML file. The location of this file depends on the operating system. For example, on Linux, it is typically located at `~/.config/filessh/config.toml`.

# DESCRIPTION

This man page documents the configuration system for the `filessh` crate. The configuration is loaded from a `config.toml` file and can be overridden by environment variables. The system allows for customization of application behavior, such as logging levels and visual themes.

The configuration is parsed using the `config` crate, which allows for a hierarchical structure. Settings can also be provided through environment variables prefixed with `FILESSH_`. For nested keys, use double underscores `__` to separate them (e.g., `FILESSH_THEME__NAME="MyTheme"`).

# CONFIGURATION FILES

`filessh` attempts to load its configuration from a file named `config.toml` in the following locations, in order of precedence:

1.  **Environment Variable**: The path specified by the `FILESSH_CONFIG` environment variable.
2.  **Platform-Specific Directory**: The standard configuration directory for the operating system:
    *   **Linux**: `$XDG_CONFIG_HOME/filessh/` or `$HOME/.config/filessh/`
    *   **macOS**: `$HOME/Library/Application Support/com.jayanaxhf.filessh/`
    *   **Windows**: `%LOCALAPPDATA%\jayanaxhf\filessh\config\` (e.g., `C:\Users\<user>\AppData\Local\jayanaxhf\filessh\config\`)
3.  **Fallback Directory**: A `.config` directory in the current working directory.

If no configuration file is found, the application will proceed with the default settings.


# CONFIGURATION OPTIONS

The following sections describe the available configuration options.

## Top-Level Settings

These options are at the root of the configuration file.

-   `debug` (boolean): If `true`, sets the logging level to `DEBUG`, providing verbose output for troubleshooting. Defaults to `false`.
-   `silent` (boolean): If `true`, suppresses all logging output except for errors. Defaults to `false`.

## Theming (`[theme]`)

The `theme` section allows for customization of the application's appearance. You can either choose from a list of predefined default themes or define your own custom theme.

### Using a Default Theme

To use a predefined theme, you can specify its name.

**Example:**

```toml
theme = "ImperialDark"
```

The available default themes are:

-   `ImperialDark` (Default)
-   `RadiumDark`
-   `TundraDark`
-   `OceanDark`
-   `MonochromeDark`
-   `BlackWhiteDark`
-   `Base16Dark`
-   `Base16RelaxDark`
-   `MonekaiDark`
-   `SolarizedDark`
-   `OxoCarbonDark`
-   `RustDark`
-   `VSCodeDark`
-   `ImperialShell`
-   `RadiumShell`
-   `TundraShell`
-   `OceanShell`
-   `MonochromeShell`
-   `BlackWhiteShell`
-   `Base16Shell`
-   `Base16RelaxShell`
-   `MonekaiShell`
-   `SolarizedShell`
-   `OxoCarbonShell`
-   `RustShell`
-   `VSCodeShell`

### Defining a Custom Theme

To define a custom theme, you must provide a `[theme]` table with the following keys:

-   `name` (string): The name of your custom theme.
-   `type_` (string): The type of theme. Can be either `"Dark"` or `"Shell"`.
-   `palette` (table): A table defining the colors used in the theme.

#### Palette (`[theme.palette]`)

The `palette` table requires a `name` and a comprehensive set of color definitions. Colors should be specified as hex strings (e.g., `"#DEDFE3"`).

-   `name` (string): The name of the palette.

**Text Colors:**

-   `text_light`: Light text color.
-   `text_bright`: Bright text color.
-   `text_dark`: Dark text color.
-   `text_black`: Black text color.

**Color Arrays:**

Each of the following keys expects an array of 8 hex color strings, representing different shades of the color.

-   `white`
-   `black`
-   `gray`
-   `red`
-   `orange`
-   `yellow`
-   `limegreen`
-   `green`
-   `bluegreen`
-   `cyan`
-   `blue`
-   `deepblue`
-   `purple`
-   `magenta`
-   `redpink`
-   `primary`
-   `secondary`

# DEFAULT CONFIGURATION

If no `config.toml` is provided, `filessh` uses a default configuration. The following is an example that mirrors the structure of the default settings, which can be found in `default_settings.toml`. This also serves as a complete example of a custom theme definition.

```toml
# default_settings.toml

debug = false
silent = false

[theme]
name = "Dark"
type_ = "Dark"

[theme.palette]
name = "Imperial"
text_light = "#DEDFE3"
text_bright = "#F6F6F3"
text_dark = "#2A2B37"
text_black = "#0F1014"
white = ["#DEDFE3", "#E6E6E8", "#EEEFEE", "#F6F6F3", "#363738", "#383839", "#3A3B3A", "#3C3C3C"]
black = ["#0F1014", "#18191F", "#21222C", "#2A2B37", "#030304", "#050607", "#08080A", "#0A0A0D"]
gray = ["#3B3D4E", "#4C4E64", "#5D617B", "#6E7291", "#0E0F13", "#121318", "#16171E", "#1B1C23"]
red = ["#480F0F", "#761919", "#A42323", "#D22D2D", "#110303", "#1D0606", "#280808", "#330B0B"]
orange = ["#482C0F", "#764818", "#A66522", "#D4812B", "#110A03", "#1D1105", "#291808", "#341F0A"]
yellow = ["#756600", "#A38E00", "#D1B600", "#FFDE00", "#1C1900", "#282300", "#332C00", "#3F3600"]
limegreen = ["#2C4611", "#48731B", "#64A127", "#80CE31", "#0A1104", "#111C06", "#182709", "#1F320C"]
green = ["#186218", "#208520", "#2AAA2A", "#32CD32", "#051805", "#072007", "#0A2A0A", "#0C320C"]
bluegreen = ["#206A52", "#29886A", "#32A682", "#3BC49A", "#071A14", "#0A211A", "#0C2920", "#0E3026"]
cyan = ["#0F2C48", "#186476", "#229CA6", "#2BD4D4", "#030A11", "#05181D", "#082629", "#0A3434"]
blue = ["#162B41", "#1D4772", "#2465A3", "#2B81D4", "#050A10", "#07111C", "#081828", "#0A1F34"]
deepblue = ["#202083", "#26269B", "#2C2CB5", "#3232CD", "#070720", "#090926", "#0A0A2C", "#0C0C32"]
purple = ["#4D008B", "#6200B1", "#7700D7", "#8C00FD", "#130022", "#18002B", "#1D0035", "#22003E"]
magenta = ["#401640", "#692469", "#943494", "#BD42BD", "#0F050F", "#190819", "#240C24", "#2E102E"]
redpink = ["#47101D", "#701E31", "#9A2E47", "#C33C5B", "#110303", "#1B070C", "#260B11", "#300E16"]
primary = ["#300057", "#4E008E", "#6E00C6", "#8C00FD", "#0B0015", "#130023", "#1B0030", "#22003E"]
secondary = ["#574B00", "#8F7C00", "#C7AD00", "#FFDE00", "#151200", "#231E00", "#312A00", "#3F3600"]
```

# EXAMPLES

## Set a Default Theme

To set the theme to `SolarizedDark`, your `config.toml` would look like this:

```toml
theme = "SolarizedDark"
```

## Override Settings with Environment Variables

You can override any configuration setting using environment variables. The variable name should be prefixed with `FILESSH_`, be in uppercase, and use `__` to separate keys.

To enable debug mode without modifying the configuration file:

```sh
export FILESSH_DEBUG=true
filessh
```

To change the theme name in a custom theme configuration:

```sh
export FILESSH_THEME__NAME="My Special Theme"
filessh
```

# SEE ALSO

`filessh(1)`
