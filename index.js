const { program } = require('commander');
const fs = require('fs');

const cache = require('./src/cache');
const ripper = require('./src/ripperV2');
const importer = require('./src/importerV2');
const reverter = require('./src/reverter');
const builder = require('./src/builder');
const assetExtractor = require('./src/assetExtractor');
const cdfDecompressor = require('./src/cdfDecompressor');
const scneObjExporter = require('./src/scneObjExporterStable');
const probeUtil = require('./2k-tools/src/util/iffCompressionProbe');

program
    .name('choops-extractor')
    .version('0.5.5')
    .description('A command line utility to extract College Hoops 2k8 (PS3) textures and more.')

program.command('rip')
    .description('Rip all or some of the game files to the specified output directory.')
    .argument('<path to game files>', 'Path to Choops game files directory (must include USRDIR in path)')
    .argument('<output path>', 'Path to output the game files')
    .option('-c, --cache', 'Force cache rebuild')
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
        await ripper(inputPath, outputPath, options);
    });

program.command('extract-assets')
    .description('Extract model, database, roster, and animation candidate payloads from IFF/CDF containers.')
    .argument('<path to game files>', 'Path to Choops game files directory (must include USRDIR in path)')
    .argument('<output path>', 'Path to output extracted assets')
    .option('-c, --cache', 'Force cache rebuild')
    .option('-i, --index <number>', 'IFF/CDF file to scan (by index)')
    .option('-f, --file <string>', 'IFF/CDF file to scan (by exact name)')
    .option('--category <categories...>', 'Asset categories to extract: models, database, rosters, animations')
    .option('--scan-all', 'Scan all files regardless of heuristics')
    .option('--dump-top-level-raw', 'Always dump raw top-level container data')
    .option('--include-all-unknown', 'Include assets even when category classification is unknown')
    .option('--max-probe-hits <number>', 'Maximum embedded compressed streams to dump from a container')
    .option('--game-name <gameName>', 'Specify which game you are ripping (valid values are: choops2k8, nba2k8, nba2k9)')
    .action(async (inputPath, outputPath, options) => {
        await assetExtractor(inputPath, outputPath, options);
    });

program.command('decompress-cdf')
    .description('Heuristically decompress and split a CDF container into candidate database/roster chunks.')
    .argument('<cdf file>', 'Path to CDF file')
    .argument('<output path>', 'Path to output decompressed chunks')
    .option('--max-hits <number>', 'Maximum decompressed streams to dump')
    .option('--dump-table-chunks', 'Attempt offset-table chunk splitting and decompression')
    .action(async (cdfFile, outputPath, options) => {
        await cdfDecompressor.decompressCdfFile(cdfFile, outputPath, options);
    });

program.command('export-scne-obj')
    .description('Export a SCNE stadium/court model into OBJ format.')
    .argument('<scne file>', 'Path to SCNE file')
    .argument('<output path>', 'Path to output OBJ files')
    .option('--primitive-mode <mode>', 'Triangle interpretation mode: strip or list', 'strip')
    .option('--position-mode <mode>', 'Position decode mode: declared, auto, float32-be/le, half3-be/le, s16norm3-be/le, s16fixed3-1024-be/le', 'declared')
    .option('--uv-mode <mode>', 'UV decode mode: declared, auto, half2-be/le, u16norm2-be/le, s16norm2-be/le, float2-be/le', 'declared')
    .option('--experimental-auto-decode', 'Allow experimental scored auto-decoding instead of stable declared defaults')
    .option('--flip-v', 'Flip UV V coordinate during export')
    .option('--dump-raw-buffers', 'Dump raw vertex/index buffers alongside OBJ export')
    .action(async (scneFile, outputPath, options) => {
        await scneObjExporter.exportScneObj(scneFile, outputPath, options);
    });

program.command('probe')
    .description('Probe an IFF/CDF for alternate compression layouts and embedded zlib streams.')
    .argument('<file>', 'Path to IFF or CDF file')
    .action(async (file) => {
        const buf = fs.readFileSync(file);
        const results = probeUtil.scanBuffer(buf);

        console.log(`Compression probe results for ${file}`);

        if (results.length <= 0) {
            console.log('No candidate compressed streams detected.');
            return;
        }

        results.forEach((result, index) => {
            console.log(
                `[${index}] algorithm=${result.algorithm} label=${result.label} `
                + `offset=0x${result.absoluteOffset.toString(16)} `
                + `size=0x${result.data.length.toString(16)}`
            );
        });
    });

program.command('build-cache')
    .description('Forces a cache build.')
    .argument('<path to game files>', 'Path to Choops game files directory (must include USRDIR in path)')
    .action(async (pathToGameFiles, options) => {
        await cache(pathToGameFiles, options);
    });

program.command('import')
    .description('Import a file to the mod overrides (does not alter the game files!)')
    .argument('<path to mod directory>', 'Path to mod directory')
    .argument('<path to file>', 'Path to the file to import')
    .option('-iff, iff <iff file name>', 'Name of the IFF file to modify')
    .option('-sub, sub <subfile name>', 'Name of the subfile to modify. If importing a SCNE texture, subfile name should include both '
        + 'SCNE and texture name (without .DDS at the end), separated with a "/". Ex: arena/texture_0')
    .action(async (pathToModDirectory, pathToFile, options) => {
        await importer(pathToModDirectory, pathToFile, options);
    });

program.command('revert')
    .description('Revert a file (warning: cannot be undone!)')
    .argument('<path to game files>', 'Path to Choops game files directory (must include USRDIR in path)')
    .argument('<iff file name>', 'Name of the IFF file to revert')
    .action(async (pathToGameFiles, iffFileName, options) => {
        await reverter.revertFile(pathToGameFiles, iffFileName, options);
    });

program.command('revert-all')
    .description('Revert the entire game archive (warning: cannot be undone!)')
    .argument('<path to game files>', 'Path to Choops game files directory (must include USRDIR in path)')
    .action(async (pathToGameFiles, options) => {
        await reverter.revertAll(pathToGameFiles, options);
    });

program.command('build')
    .description('Build mods and alter the game files (do not do this while the game is active)')
    .argument('<path to game files>', 'Path to the game files to modify')
    .argument('<path to mod files>', 'Path to the mod')
    .action(async (pathToGameFiles, pathToMod) => {
        await builder(pathToGameFiles, pathToMod);
    });

(async () => {
    await program.parseAsync(process.argv);
})();