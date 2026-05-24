const { program } = require('commander');
const fs = require('fs');

const cache = require('./src/cache');
const ripper = require('./src/ripperV2');
const importer = require('./src/importerV2');
const reverter = require('./src/reverter');
const builder = require('./src/builder');
const assetExtractor = require('./src/assetExtractor');
const cdfDecompressor = require('./src/cdfDecompressor');
const cdfTextureExtractor = require('./src/cdfTextureExtractor');
const teamselectlogoTool = require('./src/teamselectlogoTool');
const scneObjExporter = require('./src/scneObjExporterStable');
const splitPartExporter = require('./src/scneSplitPartExporter');
const smartAssetScanner = require('./src/smartAssetScanner');
const probeUtil = require('./2k-tools/src/util/iffCompressionProbe');

program
    .name('choops-extractor')
    .version('0.5.6')
    .description('A command line utility to extract College Hoops 2k8 (PS3) textures and more.')

program.command('smart-scan')
    .description('Recursively scan IFF/CDF/BIN containers and generate evidence-based structural manifests.')
    .argument('<input>', 'Input file or directory to scan')
    .argument('<output>', 'Output directory for manifests and candidate dumps')
    .option('--max-depth <number>', 'Maximum recursive scan depth', '4')
    .option('--max-hits <number>', 'Maximum raw signature hits per node', '5000')
    .option('--dump-candidates', 'Dump candidate embedded payload ranges')
    .option('--max-dump-bytes <number>', 'Maximum candidate dump size', '4194304')
    .option('--min-candidate-size <number>', 'Minimum candidate dump size', '32')
    .action(async (input, output, options) => {
        console.log('[SMART-SCAN] Starting recursive structural scan...');

        const result = await smartAssetScanner(input, output, {
            maxDepth: Number(options.maxDepth),
            maxHits: Number(options.maxHits),
            dumpCandidates: !!options.dumpCandidates,
            maxDumpBytes: Number(options.maxDumpBytes),
            minCandidateSize: Number(options.minCandidateSize)
        });

        console.log('[SMART-SCAN] Complete.');
        console.log(`[SMART-SCAN] Files scanned: ${result.manifest.summary.filesScanned}`);
        console.log(`[SMART-SCAN] IFF parsed: ${result.manifest.summary.iffParsed}`);
        console.log(`[SMART-SCAN] Assets indexed: ${result.manifest.assets.length}`);
        console.log(`[SMART-SCAN] Signatures found: ${result.manifest.summary.signaturesFound}`);
        console.log(`[SMART-SCAN] CDF texture records: ${result.manifest.summary.cdfTextureRecords}`);
        console.log(`[SMART-SCAN] Errors: ${result.manifest.summary.errors}`);
    });

program.command('rip')
    .description('Rip all or some of the game files to the specified output directory.')
    .argument('<path to game files>', 'Path to Choops game files directory (must include USRDIR in path)')
    .argument('<output path>', 'Path to output the game files')
    .option('-c, --cache', 'Force cache rebuild')
    .option('--build-cache', 'Compatibility alias for --cache')
    .option('-i, --index <number>', 'IFF file to rip (by index)')
    .option('-f, --file <string>', 'IFF file to rip (by name, include .iff on the end)')
    .option('--iff-only', 'Only rip IFFs, do not rip individual files within them')
    .option('--raw-iff', 'Do not decompress the IFF. Rip it as-is.')
    .option('--log-output <string>', 'Path to place the output log. Defaults to base output directory')
    .option('--show-console', 'Show the output in the console in addition to creating a log')
    .option('--type <types...>', 'Only output files of certain type(s). Accepts multiple inputs separated by a space. '
        + 'Supported types: UNKNOWN, TXTR, SCNE, AUDO, LAYT, MRKS, PRIV, TXT, DRCT, CLTH, AMBO, HILT, NAME, CDAN')
    .option('--raw-type', 'Output the subfile as it is in the IFF. Will not process the type (Ex: Textures will not output as DDS).')
    .option('--game-name <gameName>', 'Specify which game you are ripping (valid values are: choops2k8, nba2k8, nba2k9)')
    .action(async (inputPath, outputPath, options) => {
        if (options.buildCache) {
            options.cache = true;
        }

        await ripper(inputPath, outputPath, options);
    });

(async () => {
    await program.parseAsync(process.argv);
})();