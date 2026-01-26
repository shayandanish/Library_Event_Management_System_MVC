// Recursively walk through a directory, compressing JPEG, PNG, and WebP files.
async function compressDir(dir) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      // Recurse into subdirectories
      await compressDir(filePath);
    } else {
      // Process only JPEG, PNG, or WebP files (case-insensitive)
      const ext = path.extname(file).toLowerCase();
      try {
        if (ext === ".JPG" || ext === ".jpeg") {
          // Compress JPEG: adjust quality down from 100 (max). Higher quality
          // values produce larger files; lower values save more space but
          // degrade image fidelity. 75 is a reasonable default.
          await sharp(filePath)
            .jpeg({ quality: 75 })
            .toFile(filePath + ".tmp");
          fs.renameSync(filePath + ".tmp", filePath);
          console.log(`Compressed JPEG: ${filePath}`);
        } else if (ext === ".png") {
          // Compress PNG: use quality and compressionLevel. The `quality`
          // option for PNG controls palette quantization, while
          // `compressionLevel` (0-9) sets zlib compression.  Higher values
          // reduce file size at the cost of CPU time.  Quality around 75
          // typically reduces colors but keeps images usable.
          await sharp(filePath)
            .png({ quality: 75, compressionLevel: 9 })
            .toFile(filePath + ".tmp");
          fs.renameSync(filePath + ".tmp", filePath);
          console.log(`Compressed PNG: ${filePath}`);
        } else if (ext === ".webp") {
          // Compress WebP images
          await sharp(filePath)
            .webp({ quality: 75 })
            .toFile(filePath + ".tmp");
          fs.renameSync(filePath + ".tmp", filePath);
          console.log(`Compressed WebP: ${filePath}`);
        }
        // Unsupported file types are silently skipped
      } catch (err) {
        // Log but continue on errors; one failing file shouldn’t stop the process
        console.error(`Error compressing ${filePath}:`, err.message);
      }
    }
  }
}
