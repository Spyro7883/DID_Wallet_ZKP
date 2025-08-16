import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { buildPoseidon } from 'circomlibjs';

const [circuit, relPath] = process.argv.slice(2);
if (!circuit || !relPath) {
    console.error('Usage: node generate_input.js <CircuitName> <vpOrVcPath>');
    process.exit(1);
}

const filePath = path.isAbsolute(relPath) ? relPath : path.resolve(relPath);
const doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));

function wantedKeyFromCircuit(c) {
    const lc = String(c).toLowerCase();
    if (lc.includes('incomerange')) return 'income';
    if (lc.includes('cit')) return 'citizenship';
    if (lc.includes('age')) return 'age';
    return null;
}

function nonIdKeys(cs) {
    return Object.keys(cs || {}).filter(k => k !== 'id');
}

function selectFromDoc(document, circuitName) {
    const target = wantedKeyFromCircuit(circuitName);

    if (Array.isArray(document?.verifiableCredential)) {
        const vcs = document.verifiableCredential;
        if (target) {
            for (let i = 0; i < vcs.length; i++) {
                const cs = vcs[i]?.credentialSubject || {};
                if (Object.prototype.hasOwnProperty.call(cs, target)) {
                    return { field: target, raw: cs[target] };
                }
            }
            const available = vcs
                .map((v, i) => `VC[${i}]: [${nonIdKeys(v.credentialSubject || {}).join(', ')}]`)
                .join(' | ');
            throw new Error(`Didn't find the field "${target}" in no VC from VP. Available: ${available}`);
        }
        const cs0 = vcs[0]?.credentialSubject || {};
        const keys = nonIdKeys(cs0);
        if (keys.length === 0) throw new Error('credentialSubject is empty in the first VC.');
        return { field: keys[0], raw: cs0[keys[0]] };
    }

    const cs = document?.credentialSubject || {};
    if (target && Object.prototype.hasOwnProperty.call(cs, target)) {
        return { field: target, raw: cs[target] };
    }
    const keys = nonIdKeys(cs);
    if (keys.length === 0) throw new Error('credentialSubject is empty.');
    return { field: keys[0], raw: cs[keys[0]] };
}

const { field: name, raw } = selectFromDoc(doc, circuit);

let v;
if (name === 'age' || name === 'income') {
    try { v = BigInt(String(raw)); }
    catch { throw new Error(`${name} has to be an Int.`); }
} else {
    const hex = Buffer.from(String(raw), 'utf8').toString('hex') || '00';
    v = BigInt('0x' + hex);
}

const salt = BigInt('0x' + crypto.randomBytes(31).toString('hex'));
const poseidon = await buildPoseidon();
const F = poseidon.F;
const privHash = F.toString(poseidon([v, salt]));

function readArg(k) {
    const a = process.argv.find(x => x.startsWith(`--${k}=`));
    return a ? a.split('=')[1] : undefined;
}
let extra = {};
if (circuit === 'incomeRange' || circuit.toLowerCase().includes('incomerange')) {
    const Ls = readArg('L');
    const Us = readArg('U');
    if (!Ls || !Us) {
        console.error('❌ Set L and U:  node generate_input.js incomeRange <vpOrVcPath> --L=8000 --U=15000');
        process.exit(1);
    }
    const Li = BigInt(String(Ls));
    const Ui = BigInt(String(Us));
    if (!(Li < Ui)) throw new Error('L trebuie să fie < U');
    extra = { L: Li.toString(), U: Ui.toString() };
}

const outDir = path.join(`build/${circuit}`, `${circuit}_js`);
fs.mkdirSync(outDir, { recursive: true });

const outPath = path.join(outDir, 'input.json');
fs.writeFileSync(
    outPath,
    JSON.stringify({ [name]: v.toString(), salt: salt.toString(), privHash, ...extra }, null, 2)
);

console.log(outPath);