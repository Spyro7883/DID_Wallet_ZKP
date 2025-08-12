import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { buildPoseidon } from 'circomlibjs';

const [circuit, vcRel] = process.argv.slice(2);
if (!circuit || !vcRel) {
    console.error('Usage: node generate_input.js <CircuitName> <vcPath>');
    process.exit(1);
}

const vcPath = path.isAbsolute(vcRel) ? vcRel : path.resolve(vcRel);
const vc = JSON.parse(fs.readFileSync(vcPath, 'utf8'));

const cs = vc.credentialSubject || {};
const pair = Object.entries(cs).find(([k]) => k !== 'id');
if (!pair) {
    console.error('❌ credentialSubject is empty.');
    process.exit(1);
}
const [name, raw] = pair;

let v;
if (name === 'age' || name === 'income') {
    try { v = BigInt(String(raw)); }
    catch { throw new Error('age has to be an integer'); }
} else {
    const hex = Buffer.from(String(raw), 'utf8').toString('hex') || '00';
    v = BigInt('0x' + hex);
}

const salt = BigInt('0x' + crypto.randomBytes(31).toString('hex'));
const poseidon = await buildPoseidon();
const privHash = poseidon.F.toString(poseidon([v, salt]));

function readArg(name) {
    return process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
}

let extra = {};
if (circuit === 'incomeRange') {
    const Ls = readArg('L');
    const Us = readArg('U');
    if (!Ls || !Us) {
        console.error('❌ Set L and U:  node generate_input.js incomeRange vc_income.json --L=8000 --U=15000');
        process.exit(1);
    }
    const Li = BigInt(String(Ls));
    const Ui = BigInt(String(Us));
    if (!(Li < Ui)) throw new Error('L has to be < U');
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