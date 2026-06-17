const { startGui } = require('./src/guiServer');

async function main() {
    console.log('[GUI] Starting legacy browser launcher. Use `npm run desktop` or the packaged desktop app for the main local executable UI.');
    await startGui({ open: true });
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
});
