import { Keypair, TransactionBuilder } from "@stellar/stellar-sdk";
import type { CaatingaWalletAdapter } from "@caatinga/client";
import { env } from "../env.js";

/**
 * Server-side signer standing in for an interactive wallet. There is no
 * human to click "approve" in a backend automation/relayer, so this
 * process holds the admin keypair directly and signs on its own behalf.
 *
 * This is explicitly the backend's responsibility, not Caatinga's --
 * Caatinga's own non-goals list "store private keys" and "perform
 * silent signing" as things it deliberately does not do. See
 * docs/security.md for the full key-management story (why this exists,
 * how the secret is supplied, and how to rotate it).
 */
const keypair = Keypair.fromSecret(env.signerSecret);

export const signerPublicKey = keypair.publicKey();

export const signer: CaatingaWalletAdapter = {
  async getPublicKey() {
    return keypair.publicKey();
  },
  async signTransaction({ xdr, networkPassphrase }) {
    const tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
    tx.sign(keypair);
    return tx.toXDR();
  },
};
