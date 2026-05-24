const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, '2k-tools', 'lib');
const distDir = path.join(root, 'dist');
const tools = ['gtf2dds.exe', 'dds2gtf.exe'];

if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
}

for (const tool of tools) {
    const sourcePath = path.join(sourceDir, tool);
    const destinationPath = path.join(distDir, tool);

    if (!fs.existsSync(sourcePath)) {
        console.warn(`[WARN] Native tool not found and was not copied: ${sourcePath}`);
        continue;
    }

    fs.copyFileSync(sourcePath, destinationPath);
    console.log(`[PACK] Copied ${tool} -> ${destinationPath}`);
}
