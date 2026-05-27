const fsBase = require('fs');
const path = require('path');
const fs = require('fs/promises');
const mkdir = require('make-dir');
const { pipeline } = require('stream');
const { createLogger, format, transports } = require('winston');

const IFFWriter = require('../2k-tools/src/parser/IFFWriter');
const IFFType = require('../2k-tools/src/model/general/iff/IFFType');
const ChoopsController = require('../2k-tools/src/controller/ChoopsController');
const ChoopsTextureReader = require('../2k-tools/src/parser/choops/ChoopsTextureReaderInline');

const hashUtil = require('../2k-tools/src/util/2kHashUtil');

function cleanName(value) {
    return String(value || 'unnamed').replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

function typeCodeToFolder(typeCode) {
    const typeName = IFFType.typeToString(typeCode);
    return cleanName(typeName || 'UNKNOWN').toUpperCase();
}

function buildToolWrapper(file) {
    const toolWrapperBuf = Buffer.alloc(0xC + (file.dataBlocks.length * 4));
    toolWrapperBuf.writeUInt32BE(0x326B546C, 0x0);
    toolWrapperBuf.writeUInt32BE(toolWrapperBuf.length, 0x4);
    toolWrapperBuf.writeUInt16BE(file.type, 0x8);
    toolWrapperBuf.writeUInt16BE(file.dataBlocks.length, 0xA);

    file.dataBlocks.forEach((dataBlock, index) => {
        toolWrapperBuf.writeUInt32BE(dataBlock.data.length, 0xC + (index * 4));
    });

    return Buffer.concat([
        toolWrapperBuf,
        ...file.dataBlocks.map((block) => block.data)
    ]);
}

function makeChunkManifest({ containerName, file, fileType, rawFileName, relativeOutputPath, convertedFiles }) {
    return {
        sourceContainer: containerName,
        name: file.name,
        type: fileType.toUpperCase(),
        typeCode: file.type,
        dataBlockCount: file.dataBlocks.length,
        dataBlockSizes: file.dataBlocks.map((block) => block.data.length),
        rawFileName,
        relativeOutputPath,
        convertedFiles,
        totalRawSize: file.dataBlocks.reduce((sum, block) => sum + block.data.length, 0)
    };
}

async function writeJson(filePath, data) {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2));
}

async function writeRebuiltIff(iff, outputFilePath) {
    await new Promise((resolve, reject) => {
        pipeline(
            new IFFWriter(iff.file).createStream(),
            fsBase.createWriteStream(outputFilePath),
            (err) => {
                if (err) reject(err);
                else resolve();
            }
        )
    });
}

module.exports = async (inputPath, outputPath, options) => {
    const defaultLogPath = path.join(outputPath, '_logs', `choops-extractor-output_${Date.now().toString()}.txt`);
    let logOutput = options.logOutput ? options.logOutput : defaultLogPath;
    const sortByType = options.sortByType === true || options.sortByType === 'true';

    const loggerFormat = format.combine(
        format.colorize(),
        format.printf(
            (info) => {
                return `${info.message}`;
            }
        )
    );

    const logger = createLogger({
        level: 'info',
        format: loggerFormat,
        transports: [
            new transports.File({ filename: logOutput, options: { flags: 'w' } })
        ]
    });

    if (options.showConsole) {
        logger.add(new transports.Console({
            format: loggerFormat
        }));
    }

    logger.info('*** Choops Extractor v0.5.0 output ***');

    await hashUtil.hashLookupPromise;
    const controller = new ChoopsController(inputPath, options.gameName);

    const progressHandler = (data) => {
        logger.info(data.message);
    }

    if (options.iffOnly) {
        logger.info('\t- Reading and ripping IFF files only.');
    }

    if (options.file) {
        logger.info(`\t- Reading and ripping IFFs named "${options.file}"`);
    }

    if (options.index) {
        logger.info(`\t- Reading and ripping the IFF at index "${options.index}"`);
    }

    if (options.type) {
        logger.info(`\t- Only extracting certain types of subfiles: "${options.type}"`);
    }

    if (options.rawIff) {
        logger.info(`\t- Raw IFF: Extracting raw, compressed IFF only.`);
    }

    if (options.rawType) {
        logger.info(`\t- Raw type: Extracting raw type. Will not convert to a texture.`);
    }

    if (sortByType) {
        logger.info('\t- Sort by type: Organizing each container into TXTR/SCNE/CDAN/etc folders with manifests.');
    }

    logger.info('\n** Reading data from game files **\n');

    await mkdir(path.join(outputPath, '_overrides'));
    const textureTempDir = path.join(outputPath, '_work', 'texture-conversion');
    await mkdir(textureTempDir);

    controller.on('progress', progressHandler);
    await controller.read({
        buildCache: options.cache
    });
    controller.off('progress', progressHandler);

    let counter = 0;
    const textureReader = new ChoopsTextureReader({
        tempDir: textureTempDir
    });

    let iffsToRead = [];
    let typesToExtract = Object.keys(IFFType.TYPES).map((type) => {
        return IFFType.TYPES[type];
    });

    if (options.type && options.type.length > 0) {
        const typeCodes = options.type.map((type) => {
            return IFFType.TYPES[type];
        });

        typesToExtract = typesToExtract.filter((type) => {
            return options.type.indexOf(type) >= 0
                || typeCodes.indexOf(type) >= 0;
        });
    }
    
    if (options.index) {
        iffsToRead.push(controller.data[parseInt(options.index)]);
    }
    else if (options.file) {
        iffsToRead = controller.data.filter((iff) => {
            return iff.name === options.file;
        });
    }
    else {
        iffsToRead = controller.data;
    }

    logger.info('\n** Reading IFFs **\n');

    const masterManifest = {
        inputPath,
        outputPath,
        createdAt: new Date().toISOString(),
        sortByType,
        containers: []
    };

    for (const iffData of iffsToRead) {
        logger.info(`${counter} - ${iffData.name} (NameHash=${iffData.nameHash.toString(16).padStart(8, '0')}, GameFileIndex=${iffData.location}, GameFileOffset=${iffData.offset.toString(16)})`);
        
        const iffDataName = iffData.name.indexOf('.') >= 0 ? iffData.name.slice(0, iffData.name.length - 4) : iffData.name;
        const iffFileName = iffData.name.indexOf('.') >= 0 ? iffData.name : `${iffData.name}.iff`;
        const folderName = path.join(outputPath, cleanName(iffDataName));
        const containerDir = sortByType ? path.join(folderName, '_container') : folderName;
        const manifestsDir = path.join(folderName, '_manifests');

        const containerManifest = {
            index: counter,
            name: iffData.name,
            baseName: iffDataName,
            iffFileName,
            nameHash: iffData.nameHash.toString(16).padStart(8, '0'),
            gameFileIndex: iffData.location,
            gameFileOffsetHex: iffData.offset.toString(16),
            outputFolder: path.relative(outputPath, folderName),
            chunkCount: 0,
            typeCounts: {},
            chunks: []
        };

        try {
            await mkdir(folderName);
            if (sortByType) {
                await mkdir(containerDir);
                await mkdir(manifestsDir);
            }

            // Always dump the original container first. This preserves the old reliable behavior
            // even if the parser cannot understand one specific IFF/CDF/BIN payload yet.
            let iffBuf = null;
            try {
                iffBuf = await controller.getFileRawData(iffData.name);
                await fs.writeFile(path.join(containerDir, iffFileName), iffBuf);
            }
            catch (err) {
                const message = `Raw container extraction failed for ${iffData.name}: ${err.message || err}`;
                logger.info(message);
                containerManifest.error = message;
                masterManifest.containers.push(containerManifest);
                continue;
            }

            if (options.iffOnly) {
                if (!options.rawIff) {
                    try {
                        const iff = await controller.getFileController(iffData.name);
                        if (!(iff instanceof Buffer)) {
                            await writeRebuiltIff(iff, path.join(containerDir, iffFileName));
                        }
                    }
                    catch (err) {
                        const message = `IFF parse/rebuild failed for ${iffData.name}; kept raw file. ${err.message || err}`;
                        logger.info(message);
                        containerManifest.error = message;
                    }
                }
            }
            else {
                let iff = null;
                try {
                    iff = await controller.getFileController(iffData.name);
                }
                catch (err) {
                    const message = `IFF parse failed for ${iffData.name}; kept raw file and continuing. ${err.message || err}`;
                    logger.info(message);
                    containerManifest.error = message;
                    masterManifest.containers.push(containerManifest);
                    continue;
                }

                if (!(iff instanceof Buffer)) {
                    try {
                        for (const file of iff.file.files) {
                            if (typesToExtract.indexOf(file.type) < 0) {
                                continue;
                            }

                            const fileType = IFFType.typeToString(file.type).toLowerCase();
                            const typeFolder = sortByType ? typeCodeToFolder(file.type) : '';
                            const chunkFolderName = sortByType
                                ? path.join(folderName, typeFolder, cleanName(`${file.name}.${fileType}`))
                                : path.join(folderName, `_${file.name}.${fileType}`);
                            await mkdir(chunkFolderName);

                            const rawFileName = `${file.name}.${fileType}`;
                            const rawOutputPath = sortByType
                                ? path.join(chunkFolderName, rawFileName)
                                : path.join(folderName, rawFileName);

                            await fs.writeFile(rawOutputPath, buildToolWrapper(file));

                            const convertedFiles = [];

                            if (!options.rawType) {
                                if (file.type === IFFType.TYPES.TXTR) {
                                    const fileDds = await textureReader.toDDSFromFile(file);
                                    if (fileDds) {
                                        const ddsPath = path.join(chunkFolderName, `${file.name}.dds`);
                                        await fs.writeFile(ddsPath, fileDds);
                                        convertedFiles.push(path.relative(folderName, ddsPath));
                                    }
                                }
                                else if (file.type === IFFType.TYPES.SCNE) {
                                    try {
                                        const packageController = await iff.getFileController(file.name, IFFType.TYPES.SCNE);

                                        for (const texture of packageController.file.textures) {
                                            const fileDds = await textureReader.toDDSFromTexture(texture);
                                            if (fileDds) {
                                                const ddsPath = path.join(chunkFolderName, `${texture.name}.dds`);
                                                await fs.writeFile(ddsPath, fileDds);
                                                convertedFiles.push(path.relative(folderName, ddsPath));
                                            }
                                        }
                                    }
                                    catch (err) {
                                        logger.info(`SCNE texture extraction failed for ${iffData.name}/${file.name}: ${err.message || err}`);
                                    }
                                }
                            }

                            const typeKey = fileType.toUpperCase();
                            containerManifest.chunkCount += 1;
                            containerManifest.typeCounts[typeKey] = (containerManifest.typeCounts[typeKey] || 0) + 1;

                            const chunkManifest = makeChunkManifest({
                                containerName: iffData.name,
                                file,
                                fileType,
                                rawFileName,
                                relativeOutputPath: path.relative(folderName, rawOutputPath),
                                convertedFiles
                            });

                            containerManifest.chunks.push(chunkManifest);

                            if (sortByType) {
                                await writeJson(path.join(chunkFolderName, `${file.name}.manifest.json`), chunkManifest);
                            }
                        }
                    }
                    catch (err) {
                        logger.info(`Chunk extraction failed for ${iffData.name}; kept raw file. ${err.message || err}`);
                        containerManifest.error = '' + err;
                    }
                }
            }
        }
        catch (err) {
            const message = `Container rip failed for ${iffData.name}; continuing. ${err.message || err}`;
            logger.info(message);
            containerManifest.error = message;
        }
        finally {
            if (sortByType) {
                try {
                    await mkdir(manifestsDir);
                    await writeJson(path.join(manifestsDir, 'container_manifest.json'), containerManifest);
                }
                catch (err) {
                    logger.info(`Failed to write manifest for ${iffData.name}: ${err.message || err}`);
                }
            }

            masterManifest.containers.push(containerManifest);
            counter += 1;
        }
    }

    try {
        await fs.rm(textureTempDir, { recursive: true, force: true });
    }
    catch (err) {
        logger.info(`Failed to clean texture temp directory: ${err.message || err}`);
    }

    if (sortByType) {
        await mkdir(path.join(outputPath, '_summary'));
        await writeJson(path.join(outputPath, '_summary', 'rip_manifest.json'), masterManifest);
    }
};