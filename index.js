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

program.command('extract-cdf-textures')
    .description('Extract CDF texture records and optionally convert them to DDS using bundled gtf2dds.exe.')
    .argument('<cdf file>', 'Path to CDF texture file, such as teamselectlogo.cdf')
    .argument('<output path>', 'Path to output extracted records and DDS files')
    .option('--iff <iff file>', 'Optional matching IFF metadata file, such as teamselectlogo.iff')
    .option('--dds', 'Attempt DDS conversion using bundled gtf2dds.exe')
    .option('--limit <number>', 'Only process the first N records for quick testing')
    .option('--gtf2dds-path <path>', 'Override path to gtf2dds.exe')
    .option('--keep-gtf-candidates', 'Keep temporary .gtf candidate files used for conversion tests')
    .option('--dump-full-records', 'Dump each full CDF texture record as .cdftex')
    .option('--dump-headers', 'Dump each parsed CDF texture header')
    .option('--no-dump-payloads', 'Do not dump raw payload files unless needed for DDS conversion')
    .option('--scan-all', 'Brute-force scan the entire CDF for texture records')
    .option('--verbose', 'Enable verbose debug logging')
    .action(async (cdfFile, outputPath, options) => {
        await cdfTextureExtractor.extractCdfTextureRecords(cdfFile, outputPath, {
            ...options,
            iffPath: options.iff,
            convertDds: options.dds,
            scanAll: options.scanAll,
            verbose: options.verbose
        });
    });

program.command('export-teamselectlogo-dds')
    .description('Export teamselectlogo.cdf records into editable DDS files.')
    .argument('<cdf file>', 'Path to teamselectlogo.cdf')
    .argument('<iff file>', 'Path to teamselectlogo.iff')
    .argument('<output path>', 'Output folder for editable DDS files')
    .option('--verbose', 'Enable verbose logging')
    .option('--export-mode <mode>', 'Export mode: gtf or manual', 'gtf')
    .option('--gtf2dds-path <path>', 'Override path to gtf2dds.exe')
    .option('--keep-gtf', 'Keep synthesized .gtf files next to the DDS export')
    .option('--swizzle-mode <mode>', 'Manual mode image block mode: none, morton, morton-yx, block-rect, or byte-rect', 'block-rect')
    .option('--image-data-offset <number>', 'Manual mode override for byte offset inside each CDF record where image data begins')
    .option('--dump-variants', 'Manual mode: export none/morton/morton-yx/block-rect/byte-rect DDS variants for comparison')
    .action(async (cdfFile, iffFile, outputPath, options) => {
        await teamselectlogoTool.exportTeamselectlogo(
            cdfFile,
            iffFile,
            outputPath,
            options
        );
    });

program.command('import-teamselectlogo-dds')
    .description('Reimport edited DDS files back into a teamselectlogo.cdf archive.')
    .argument('<original cdf>', 'Original teamselectlogo.cdf')
    .argument('<manifest>', 'teamselectlogo_manifest.json from export step')
    .argument('<edited dds dir>', 'Directory containing edited DDS files')
    .argument('<output cdf>', 'Output rebuilt CDF path')
    .action(async (originalCdf, manifest, editedDdsDir, outputCdf) => {
        await teamselectlogoTool.importTeamselectlogo(
            originalCdf,
            manifest,
            editedDdsDir,
            outputCdf
        );
    });

program.command('export-scne-obj')
    .description('Export a SCNE stadium/court model into OBJ format.')
    .argument('<scne file>', 'Path to SCNE file')
    .argument('<output path>', 'Path to output OBJ files')
    .option('--primitive-mode <mode>', 'Triangle interpretation mode: strip or list', 'strip')
    .option('--position-mode <mode>', 'Position decode mode', 'declared')
    .option('--uv-mode <mode>', 'UV decode mode', 'declared')
    .option('--experimental-auto-decode', 'Allow experimental scored auto-decoding instead of stable declared defaults')
    .option('--split-parts', 'Export each SCNE model part into its own OBJ/MTL pair for debugging')
    .option('--part <numbers>', 'Export only specific model part indices, comma separated. Example: --part 9 or --part 9,54,55')
    .option('--part-variants', 'Generate alternate descriptor/topology interpretations for selected parts')
    .option('--variant-vertex-limit <number>', 'Maximum nearby vertex descriptors to test in --part-variants mode', '8')
    .option('--flip-v', 'Flip UV V coordinate during export')
    .option('--dump-raw-buffers', 'Dump raw vertex/index buffers alongside OBJ export')
    .action(async (scneFile, outputPath, options) => {
        if (options.splitParts || options.part || options.partVariants) {
            await splitPartExporter.exportScneSplitParts(scneFile, outputPath, options);
        }
        else {
            await scneObjExporter.exportScneObj(scneFile, outputPath, options);
        }
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