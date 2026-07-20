# BNDZ Privacy Policy

**Version 1.0**

BNDZ is a local Windows desktop application. We design it to keep your files on your machine.

## Data we do not collect by default

- BNDZ does not upload your files, folder listings, or browsing history to BNDZ servers during normal use.
- Settings are stored locally under `%AppData%\BNDZ64\`.
- License activation stores your serial, email, and name locally for validation only. Online activation also sends serial, email, name, and a hashed machine id to the BNDZ license service to bind one seat per serial; no file contents are sent.

## Optional network use

- **License activation / validation** (required to activate after trial): contacts the BNDZ license API to bind or check your seat. Sends serial, registration email/name, and a hashed hardware id — not your files or folder listings.
- **Check for Updates** (Help menu): if configured, BNDZ contacts the URL in `updateCheckUrl` to compare versions. No file data is sent.
- **AI features** (optional): if you consent to download the local AI model, the model file is fetched once from the vendor CDN and cached offline. Prompts are processed locally via LLamaSharp; they are not sent to cloud AI APIs in the native app.
- **Everything search**: if installed, search queries may be handled by the Everything desktop utility on your PC.

## Third-party software

WebView2 (Microsoft) renders the UI. See Microsoft privacy terms for WebView2 runtime.

## Contact

For privacy questions, contact your BNDZ vendor support channel.
