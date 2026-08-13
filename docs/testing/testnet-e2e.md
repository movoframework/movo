# Testnet e2e

Set `MOVO_E2E=1`, `STELLAR_PRIVATE_KEY`, and `MOVO_PAY_TO` only for a funded Stellar testnet
account with the required USDC trustline. The suite must never run on pubnet. It reports
UNVERIFIED when those credentials are absent; no mock transaction is settlement evidence.
