const { program } = require('commander');
const rosterTool = require('./src/rosterTool');

program
    .name('choops-roster')
    .description('College Hoops 2K8 ROST decoder and roster research utility.')
    .version('0.1.0');

program.command('decode')
    .description('Decode a College Hoops 2K8 ROST payload from roster_english.iff, raw ROST, decrypted USERDATA, or a decrypted save ZIP.')
    .argument('<input>', 'Path to roster_english.iff, raw ROST payload, decrypted USERDATA, or save ZIP containing USERDATA')
    .argument('<output path>', 'Output directory for roster CSV files')
    .action(async (inputPath, outputPath) => {
        const summary = await rosterTool.decodeRoster(inputPath, outputPath);
        console.log('[ROSTER] Decode complete.');
        console.log(`[ROSTER] Source type: ${summary.sourceType}`);
        console.log(`[ROSTER] Payload size: ${summary.payloadSize}`);
        console.log(`[ROSTER] Players: ${summary.players}`);
        console.log(`[ROSTER] Teams: ${summary.teams}`);
        console.log(`[ROSTER] Arenas: ${summary.arenas}`);
        console.log(`[ROSTER] Coaches: ${summary.coaches}`);
    });

program.command('compare')
    .description('Compare a base roster against a custom roster and export player/team diff CSV files.')
    .argument('<base roster>', 'Base roster_english.iff, raw ROST, USERDATA, or save ZIP')
    .argument('<custom roster>', 'Custom roster_english.iff, raw ROST, USERDATA, or save ZIP')
    .argument('<output path>', 'Output directory for comparison CSV files')
    .action(async (baseRoster, customRoster, outputPath) => {
        const summary = await rosterTool.compareRosters(baseRoster, customRoster, outputPath);
        console.log('[ROSTER] Compare complete.');
        console.log(`[ROSTER] Base source: ${summary.baseSourceType}`);
        console.log(`[ROSTER] Custom source: ${summary.customSourceType}`);
        console.log(`[ROSTER] Players changed: ${summary.playersChanged}`);
        console.log(`[ROSTER] Teams changed: ${summary.teamsChanged}`);
        console.log(`[ROSTER] Custom extra bytes vs base: ${summary.customExtraBytesVsBase}`);
    });

(async () => {
    await program.parseAsync(process.argv);
})();