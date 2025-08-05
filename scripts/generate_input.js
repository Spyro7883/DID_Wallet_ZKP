import fs from 'fs';
import { buildPoseidon } from 'circomlibjs';
import crypto from 'crypto';

async function main() {
    const vc = JSON.parse(fs.readFileSync('rest/vc_test.json', 'utf8'));
    const age = Number(vc.credentialSubject.age);

    const salt = BigInt('0x' + crypto.randomBytes(31).toString('hex'));

    const poseidon = await buildPoseidon();
    const F = poseidon.F;
    const hash = poseidon([BigInt(age), salt]);

    const input = {
        age: age.toString(),
        salt: salt.toString(),
        privHash: F.toString(hash),
        threshold: 18
    };
    fs.writeFileSync('build/input.json', JSON.stringify(input, null, 2));
    console.log('input.json has been generated');
}

main().catch(console.error);
