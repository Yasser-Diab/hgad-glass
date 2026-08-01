const { app, nativeImage } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const sourceRoot = path.join(root, "new-logo-assets");
const androidSourcePath = path.join(sourceRoot, "android-app-icon-source.png");
const loadingSourcePath = path.join(sourceRoot, "full logo asset for loading screen and big icons.png");
const traySourcePath = path.join(sourceRoot, "tray icon source.png");
const smallAppSourcePath = path.join(sourceRoot, "small in appp logo source.png");

function loadSource(sourcePath) {
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error(`Unable to load ${sourcePath}`);
  return image;
}

function pngAt(image, size) {
  return image.resize({ width: size, height: size, quality: "best" }).toPNG();
}

function cropTrayArtwork(image, cropRatio = 0.7) {
  const { width, height } = image.getSize();
  const cropSize = Math.round(Math.min(width, height) * cropRatio);
  return image.crop({
    x: Math.max(0, Math.round((width - cropSize) / 2)),
    y: Math.max(0, Math.round((height - cropSize) / 2 - height * 0.03)),
    width: cropSize,
    height: cropSize
  });
}

function icoFromPngEntries(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(entries.length, 4);
  const directory = Buffer.alloc(entries.length * 16);
  let offset = header.length + directory.length;
  entries.forEach(({ size, png }, index) => {
    const base = index * 16;
    directory.writeUInt8(size >= 256 ? 0 : size, base);
    directory.writeUInt8(size >= 256 ? 0 : size, base + 1);
    directory.writeUInt8(0, base + 2);
    directory.writeUInt8(0, base + 3);
    directory.writeUInt16LE(1, base + 4);
    directory.writeUInt16LE(32, base + 6);
    directory.writeUInt32LE(png.length, base + 8);
    directory.writeUInt32LE(offset, base + 12);
    offset += png.length;
  });
  return Buffer.concat([header, directory, ...entries.map(({ png }) => png)]);
}

function writePng(relativePath, image, size) {
  const destination = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, pngAt(image, size));
}

app.whenReady().then(() => {
  const androidSource = loadSource(androidSourcePath);
  const loadingSource = loadSource(loadingSourcePath);
  const trayArtwork = loadSource(traySourcePath);
  const traySource = cropTrayArtwork(trayArtwork, 0.7);
  // Windows shell icons need a bold silhouette at 16–32 px. The Android
  // artwork contains a second rounded frame and broad dark margins, which
  // turns into an indistinct square in the taskbar. Use the tightly cropped,
  // transparent glass-panel mark for Windows and browser chrome instead.
  const desktopIconSource = cropTrayArtwork(trayArtwork, 0.52);
  const smallAppSource = loadSource(smallAppSourcePath);
  const icoEntries = [16, 20, 24, 32, 40, 48, 64, 128, 256].map((size) => ({ size, png: pngAt(desktopIconSource, size) }));
  fs.writeFileSync(path.join(root, "icons", "app-icon.ico"), icoFromPngEntries(icoEntries));
  writePng("icons/app-icon.png", desktopIconSource, 512);
  writePng("icons/tray-icon.png", traySource, 64);
  writePng("icons/in-app-logo.png", smallAppSource, 512);
  writePng("icons/loading-logo.png", loadingSource, 640);
  writePng("public/app-icon.png", desktopIconSource, 192);

  const androidSizes = {
    "mipmap-mdpi": 48,
    "mipmap-hdpi": 72,
    "mipmap-xhdpi": 96,
    "mipmap-xxhdpi": 144,
    "mipmap-xxxhdpi": 192
  };
  for (const [folder, size] of Object.entries(androidSizes)) {
    for (const fileName of ["ic_launcher.png", "ic_launcher_foreground.png", "ic_launcher_round.png"]) {
      writePng(path.join("android", "app", "src", "main", "res", folder, fileName), androidSource, size);
    }
  }

  console.log("Generated Y.D Glass Manager assets from new-logo-assets.");
  app.quit();
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
