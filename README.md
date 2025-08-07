# DID_Wallet_ZKP

## Commands

Verify veramo config:

npx veramo config check -f agent.yml

Generate DID payload:

npx veramo execute -m cheqdGenerateDidDoc --argsFile did_template.json > did_doc.json

Generate DID keys:

npx veramo execute -m cheqdCreateIdentifier --argsFile payload.json

Issue a VC

npx veramo credential create --json

Verify a VC

npx veramo credential verify --raw "jwt-string"

Check if DID document exists

npx veramo did resolve "your-did"

Look at your document on the cheqd space

curl -L "https://resolver.cheqd.net/1.0/identifiers/your-did/resources/checksum-value" --output file-name

snarkjs generatecall | sed '1s/^/[/; $s/$/]/' > calldata.json
