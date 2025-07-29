# DID_Wallet_ZKP

## Commands

Verify veramo config:

npx veramo config check -f agent.yml

Generate DID payload:

npx veramo execute -m cheqdGenerateDidDoc --argsFile did_template.json > did_doc.json

Generate DID keys:

npx veramo execute -m cheqdCreateIdentifier --argsFile payload.json
