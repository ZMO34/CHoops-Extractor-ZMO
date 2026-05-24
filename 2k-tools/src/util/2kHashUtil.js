const path = require('path');
const Long = require('long');
const fs = require('fs/promises');

const heapUtil = require('./choops/choopsHeapUtil.js');

let heapData, hashLookup;
let generatedHashMapPromise = null;

module.exports.heapPromise = new Promise(async (resolve, reject) => {
    heapData = await heapUtil.getHeap();
    resolve();
});

const PATH_TO_HASHLOOKUP = path.join(__dirname, '../data/hash-lookup.json');

module.exports.hashLookupPromise = new Promise(async (resolve, reject) => {
    hashLookup = await fs.readFile(PATH_TO_HASHLOOKUP, 'utf-8');
    hashLookup = JSON.parse(hashLookup);
    resolve();
});

module.exports.hash = async (stringToHash, initialHash = 0xFFFFFFFF) => {
    await this.heapPromise;
    await this.hashLookupPromise;

    let upperString = stringToHash.toUpperCase();

    let tempData;
    let tempOffset;
    let workingHash = Long.fromInt(initialHash, true);

    for (let i = 0; i < stringToHash.length; i++) {
        let currentCharacter = upperString.charCodeAt(i);

        do {
            tempOffset = workingHash.xor(currentCharacter);
            currentCharacter >>= 8;
            tempOffset = rldic(tempOffset, 2, 54);
            tempData = heapData.readUInt32BE(tempOffset.getLowBitsUnsigned());
            workingHash = workingHash.and(0xFFFFFF00).shiftRightUnsigned(8).xor(tempData);
        } while (currentCharacter !== 0);
    }

    workingHash = workingHash.not();
    return workingHash.getLowBitsUnsigned();
};

function rldic(theLong, shift, maskBit) {
    return theLong.rotateLeft(shift).and(new Long(0xFFFFFFFF, 0xFFFFFFFF, true).shiftRightUnsigned(maskBit + shift).shiftLeft(shift));
};

function addNameVariants(candidates, baseName, extensions = ['.iff']) {
    candidates.add(baseName);

    for (const extension of extensions) {
        candidates.add(`${baseName}${extension}`);
    }
}

function generateCandidateNames() {
    const candidates = new Set();

    for (let i = 0; i <= 999; i++) {
        const id3 = i.toString().padStart(3, '0');
        const id4 = i.toString().padStart(4, '0');

        ['ua', 'uh', 'ux', 'selua', 'seluh', 'selux', 's', 'm'].forEach((prefix) => {
            addNameVariants(candidates, `${prefix}${id3}`);
        });

        addNameVariants(candidates, `coach${id3}`);
        addNameVariants(candidates, `h${id4}`);
    }

    return [...candidates];
};

async function getGeneratedHashMap() {
    if (!generatedHashMapPromise) {
        generatedHashMapPromise = (async () => {
            const map = new Map();

            for (const candidate of generateCandidateNames()) {
                const candidateHash = await module.exports.hash(candidate);

                if (!map.has(candidateHash)) {
                    map.set(candidateHash, {
                        hash: candidateHash,
                        str: candidate,
                        generated: true
                    });
                }
            }

            return map;
        })();
    }

    return generatedHashMapPromise;
};

module.exports.generateCandidateNames = generateCandidateNames;

module.exports.resolveCandidateName = async function(candidateName) {
    await this.hashLookupPromise;

    const namesToTry = new Set();
    namesToTry.add(candidateName);

    const parsed = path.parse(candidateName);
    if (parsed.ext) {
        namesToTry.add(parsed.name);
    }
    else {
        namesToTry.add(`${candidateName}.iff`);
        namesToTry.add(`${candidateName}.cdf`);
        namesToTry.add(`${candidateName}.bin`);
    }

    for (const name of namesToTry) {
        const hash = await this.hash(name);
        const existing = hashLookup.find(item => item.hash === hash);

        if (existing) {
            return existing;
        }

        return {
            hash,
            str: name,
            generated: true
        };
    }

    return null;
};

module.exports.hashLookup = async function(hash, options = {}) {
    await this.hashLookupPromise;

    const existing = hashLookup.find(item => {
        return item.hash === hash;
    });

    if (existing) {
        return existing;
    }

    if (!options.allowGenerated) {
        return null;
    }

    const generatedHashMap = await getGeneratedHashMap();
    const generated = generatedHashMap.get(hash);

    if (generated) {
        console.log(`Auto-resolved hash 0x${hash.toString(16)} -> ${generated.str}`);
        return generated;
    }

    return null;
};