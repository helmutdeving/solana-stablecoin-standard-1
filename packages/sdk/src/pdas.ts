import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";

export class PDAs {
  constructor(private readonly programId: PublicKey) {}

  config(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("sss-config"), mint.toBuffer()],
      this.programId
    );
  }

  compliance(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("sss-compliance"), mint.toBuffer()],
      this.programId
    );
  }

  whitelist(mint: PublicKey, wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("sss-whitelist"), mint.toBuffer(), wallet.toBuffer()],
      this.programId
    );
  }

  freeze(mint: PublicKey, wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("sss-freeze"), mint.toBuffer(), wallet.toBuffer()],
      this.programId
    );
  }

  complianceEvent(mint: PublicKey, eventId: BN): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from("sss-event"),
        mint.toBuffer(),
        eventId.toArrayLike(Buffer, "le", 8),
      ],
      this.programId
    );
  }

  // ─── SSS-3 PDAs ──────────────────────────────────────────────────────────────

  sss3Config(mint: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("sss3-config"), mint.toBuffer()],
      this.programId
    );
  }

  sss3Allowlist(mint: PublicKey, wallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("sss3-allowlist"), mint.toBuffer(), wallet.toBuffer()],
      this.programId
    );
  }
}
