const { startGui } = require('./src/guiServer');
const rosterTool = require('./src/rosterTool');

async function main() {
    const args = process.argv.slice(2);

    if (args[0] === '__roster') {
        const mode = args[1];
        if (mode === 'decode') {
            const summary = await rosterTool.decodeRoster(args[2], args[3]);
            console.log('[ROSTER] Decode complete.');
            console.log(JSON.stringify(summary, null, 2));
            return;
        }
        if (mode === 'compare') {
            const summary = await rosterTool.compareRosters(args[2], args[3], args[4]);
            console.log('[ROSTER] Compare complete.');
            console.log(JSON.stringify(summary, null, 2));
            return;
        }
        throw new Error(`Unknown roster mode: ${mode}`);
    }

    await startGui({ open: true });
}

main().catch((err) => {
    console.error(err.stack || err.message || err);
    process.exit(1);
});
