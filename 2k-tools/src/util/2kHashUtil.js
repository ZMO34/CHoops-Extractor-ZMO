const path = require('path');
const Long = require('long');
const fs = require('fs/promises');

const heapUtil = require('./choops/choopsHeapUtil.js');
const gameProfiles = require('./gameProfiles');

let heapData, hashLookup;
const generatedHashMapPromises = new Map();

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

function normalizeGameName(gameName) {
    return gameProfiles.getProfile(gameName).id;
}

function generateCandidateNames(gameName) {
    return gameProfiles.generateCandidateNames(gameName);
};

async function getGeneratedHashMap(gameName) {
    const profileId = normalizeGameName(gameName);

    if (!generatedHashMapPromises.has(profileId)) {
        generatedHashMapPromises.set(profileId, (async () => {
            const map = new Map();

            for (const candidate of generateCandidateNames(profileId)) {
                const candidateHash = await module.exports.hash(candidate);

                if (!map.has(candidateHash)) {
                    map.set(candidateHash, {
                        hash: candidateHash,
                        str: candidate,
                        generated: true,
                        gameName: profileId
                    });
                }
            }

            return map;
        })());
    }

    return generatedHashMapPromises.get(profileId);
};

module.exports.generateCandidateNames = generateCandidateNames;

module.exports.resolveCandidateName = async function(candidateName, options = {}) {
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
            generated: true,
            gameName: normalizeGameName(options.gameName)
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

    const profileId = normalizeGameName(options.gameName);
    const generatedHashMap = await getGeneratedHashMap(profileId);
    const generated = generatedHashMap.get(hash);

    if (generated) {
        console.log(`Auto-resolved ${profileId} hash 0x${hash.toString(16)} -> ${generated.str}`);
        return generated;
    }

    return null;
};