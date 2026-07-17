# Build assets

`electron-builder` (see `package.json` → `build`) expects platform icons here.
The entitlements file is committed; the icon binaries must be generated from a
single 1024×1024 source PNG before running `npm run dist`:

```
assets/
  entitlements.mac.plist   # committed (hardened-runtime entitlements)
  icons/
    mac/icon.icns          # generate from icon-1024.png (iconutil)
    win/icon.ico           # generate (e.g. png-to-ico / ImageMagick)
    png/512x512.png        # Linux
```

Generate from a source `icon-1024.png`:

```bash
# macOS .icns
mkdir icon.iconset
sips -z 16 16   icon-1024.png --out icon.iconset/icon_16x16.png
sips -z 32 32   icon-1024.png --out icon.iconset/icon_16x16@2x.png
sips -z 128 128 icon-1024.png --out icon.iconset/icon_128x128.png
sips -z 256 256 icon-1024.png --out icon.iconset/icon_256x256.png
sips -z 512 512 icon-1024.png --out icon.iconset/icon_512x512.png
sips -z 1024 1024 icon-1024.png --out icon.iconset/icon_512x512@2x.png
iconutil -c icns icon.iconset -o icons/mac/icon.icns

# Windows .ico (ImageMagick)
magick icon-1024.png -define icon:auto-resize=256,128,64,48,32,16 icons/win/icon.ico

# Linux
sips -z 512 512 icon-1024.png --out icons/png/512x512.png
```

`npm run build` (typecheck + renderer + main compile) does **not** require these;
only `npm run dist` (packaging) does.
