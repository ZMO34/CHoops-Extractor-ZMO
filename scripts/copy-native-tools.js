const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, '2k-tools', 'lib');
const releaseDir = path.join(root, 'release');
const tools = ['gtf2dds.exe', 'dds2gtf.exe'];

if (!fs.existsSync(releaseDir)) {
    fs.mkdirSync(releaseDir, { recursive: true });
}

for (const tool of tools) {
    const sourcePath = path.join(sourceDir, tool);
    const destinationPath = path.join(releaseDir, tool);

    if (!fs.existsSync(sourcePath)) {
        console.warn(`[WARN] Native tool not found and was not copied: ${sourcePath}`);
        continue;
    }

    fs.copyFileSync(sourcePath, destinationPath);
    console.log(`[PACK] Copied ${tool} -> ${destinationPath}`);
}
