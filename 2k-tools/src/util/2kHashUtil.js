const path = require('path');
const Long = require('long');
const fs = require('fs/promises');

const heapUtil = require('./choops/choopsHeapUtil.js');

let heapData, hashLookup;

module.exports.heapPromise = new Promise(async (resolve, reject) => {
    heapData = await heapUtil.getHeap()
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

async function persistLookup(str, hash) {
    const existing = hashLookup.find(item => {
        return item.hash === hash;
    });

    if (existing) {
        return existing;
    }

    const newEntry = {
        hash,
        str
    };

    hashLookup.push(newEntry);

    try {
        await fs.writeFile(PATH_TO_HASHLOOKUP, JSON.stringify(hashLookup, null, 2));
    }
    catch (err) {
        console.warn(`Failed to persist hash lookup for ${str}: ${err.message}`);
    }

    return newEntry;
};

function generateCandidateNames() {
    const candidates = [];

    for (let i = 0; i <= 999; i++) {
        const id = i.toString().padStart(3, '0');

        candidates.push(`ua${id}`);
        candidates.push(`uh${id}`);
        candidates.push(`ux${id}`);

        candidates.push(`selua${id}`);
        candidates.push(`seluh${id}`);
        candidates.push(`selux${id}`);

        candidates.push(`coach${id}`);
        candidates.push(`s${id}`);
        candidates.push(`m${id}`);
    }

    return candidates;
};

module.exports.hashLookup = async function(hash) {
    await this.hashLookupPromise;

    const existing = hashLookup.find(item => {
        return item.hash === hash;
    });

    if (existing) {
        return existing;
    }

    const candidates = generateCandidateNames();

    for (const candidate of candidates) {
        const generatedHash = await this.hash(candidate);

        if (generatedHash === hash) {
            console.log(`Auto-resolved hash 0x${hash.toString(16)} -> ${candidate}`);
            return await persistLookup(candidate, hash);
        }
    }

    return null;
};