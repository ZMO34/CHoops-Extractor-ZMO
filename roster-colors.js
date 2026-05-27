const { program } = require('commander');
const rosterColorTool = require('./src/rosterColorTool');

program
    .name('choops-roster-colors')
    .description('College Hoops 2K8 roster team color palette dumper.')
    .version('0.1.0');

program.command('dump')
    .description('Dump the 32 RGBA team color slots from roster_english.iff, raw ROST, USERDATA, or save ZIP.')
    .argument('<input>', 'Path to roster_english.iff, raw ROST payload, decrypted USERDATA, or save ZIP containing USERDATA')
    .argument('<output path>', 'Output directory for team_colors.csv')
    .action(async (inputPath, outputPath) => {
        const summary = await rosterColorTool.dumpTeamColors(inputPath, outputPath);
        console.log('[ROSTER-COLORS] Dump complete.');
        console.log(`[ROSTER-COLORS] Source type: ${summary.sourceType}`);
        console.log(`[ROSTER-COLORS] Payload size: ${summary.payloadSize}`);
        console.log(`[ROSTER-COLORS] Rows: ${summary.rows}`);
    });

(async () => {
    await program.parseAsync(process.argv);
})();
