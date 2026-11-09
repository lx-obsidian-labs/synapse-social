"""Package a Chrome extension with its manifest at the archive root."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
import sys

ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
REQUIRED = (
    "manifest.json", "background.js", "content.js", "sidepanel.js",
    "shell.js", "popup.js", "sidepanel.html", "popup.html", "browser-flow.js",
    "skills.js", "skills-ui.js", "obsidian.css",
)

def main():
    missing = [name for name in REQUIRED if not (DIST / name).is_file()]
    if missing:
        sys.exit("ERROR: Missing extension files: " + ", ".join(missing))
    manifest = json.loads((DIST / "manifest.json").read_text(encoding="utf-8"))
    out = ROOT / f"synapse-ai-v{manifest['version']}-test.zip"
    if manifest.get("manifest_version") != 3:
        sys.exit("ERROR: Expected Manifest V3")
    files = sorted(p for p in DIST.rglob("*") if p.is_file())
    if not files:
        sys.exit("ERROR: Empty dist directory")
    with ZipFile(out, "w", compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for file in files:
            archive.write(file, file.relative_to(DIST).as_posix())
    with ZipFile(out) as archive:
        bad = archive.testzip()
        if bad:
            sys.exit(f"ERROR: Corrupt ZIP entry: {bad}")
        names = set(archive.namelist())
        missing = set(REQUIRED) - names
        if missing:
            sys.exit("ERROR: ZIP missing root-level files: " + ", ".join(sorted(missing)))
        if "dist/manifest.json" in names:
            sys.exit("ERROR: Manifest incorrectly nested under dist/")
    print(f"Verified {out.name}: {len(files)} files, {out.stat().st_size} bytes")

if __name__ == "__main__":
    main()
