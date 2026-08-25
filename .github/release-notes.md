## Install

**Windows** — download `hypercode-desktop-win-x64.exe` and double-click.
If SmartScreen warns on first launch, choose **More info → Run anyway**. That warning is
standard for an application that is not yet code-signed.

**macOS** — download the `.dmg` for your chip (`mac-arm64` for Apple Silicon, `mac-x64`
for Intel) and drag HyperCode to Applications.

The first launch needs a one-time authorization, because this build is not yet signed with
an Apple Developer ID. In Terminal, run:

```
xattr -dr com.apple.quarantine /Applications/HyperCode.app
```

then open the app normally. Unlike Windows, right-click → Open does not get past this on
Apple Silicon. Code signing is in progress and will remove the step.

## Updating

Windows updates itself: the app checks on launch and offers the new version when one is
published. macOS is manual for now — download the new `.dmg` and replace the app.
