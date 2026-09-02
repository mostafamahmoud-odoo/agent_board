#!/usr/bin/env bash
# Builds claude-notes-panel-<version>.vsix without vsce (a .vsix is just a zip).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="$(node -p "require('$ROOT/package.json').version")"
BUILD="$(mktemp -d)"
trap 'rm -rf "$BUILD"' EXIT

mkdir -p "$BUILD/extension"
cp -r "$ROOT/src" "$ROOT/media" "$ROOT/skill" "$ROOT/package.json" "$ROOT/README.md" "$BUILD/extension/"

cat > "$BUILD/[Content_Types].xml" <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="json" ContentType="application/json" />
  <Default Extension="js" ContentType="application/javascript" />
  <Default Extension="html" ContentType="text/html" />
  <Default Extension="md" ContentType="text/markdown" />
  <Default Extension="vsixmanifest" ContentType="text/xml" />
</Types>
XML

cat > "$BUILD/extension.vsixmanifest" <<XML
<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="claude-notes-panel" Version="${VERSION}" Publisher="local" />
    <DisplayName>Claude Notes Panel</DisplayName>
    <Description xml:space="preserve">Renders Claude's planning notes as sketchy diagrams or mermaid flowcharts in a side panel instead of files/text.</Description>
    <Tags>claude,notes,mermaid,diagram</Tags>
    <Categories>Other</Categories>
    <GalleryFlags>Public</GalleryFlags>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code" />
  </Installation>
  <Dependencies />
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
XML

OUT="$ROOT/claude-notes-panel-${VERSION}.vsix"
rm -f "$OUT"
(cd "$BUILD" && zip -qr "$OUT" .)
echo "built $OUT"
