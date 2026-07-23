import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

const CONTRACT_ID = /^C[A-Z2-7]{55}$/;
const PROPOSAL_ID = /^[0-9a-f]{64}$/;

function valid(entry) {
  return entry &&
    PROPOSAL_ID.test(entry.proposalId) &&
    CONTRACT_ID.test(entry.market) &&
    CONTRACT_ID.test(entry.liquidityVault);
}

function save(path, proposals) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  writeFileSync(
    temporary,
    `${JSON.stringify({ format: 1, proposals }, null, 2)}\n`,
  );
  renameSync(temporary, path);
}

export class PrivateProposalRegistry {
  constructor({ stateFile, verify }) {
    if (!stateFile || !verify) {
      throw new Error("private proposal registry configuration is incomplete");
    }
    this.stateFile = stateFile;
    this.verify = verify;
    this.proposals = [];
    if (existsSync(stateFile)) {
      const value = JSON.parse(readFileSync(stateFile, "utf8"));
      if (
        value.format !== 1 ||
        !Array.isArray(value.proposals) ||
        value.proposals.some((entry) => !valid(entry))
      ) {
        throw new Error("private proposal registry state is invalid");
      }
      this.proposals = value.proposals.filter((entry, index, entries) =>
        entries.findIndex((candidate) =>
          candidate.proposalId === entry.proposalId
        ) === index
      );
    }
  }

  list() {
    return this.proposals.map((entry) => ({ ...entry }));
  }

  async register(proposalId) {
    if (typeof proposalId !== "string" || !PROPOSAL_ID.test(proposalId)) {
      throw new Error("invalid proposal ID");
    }
    const verified = await this.verify(proposalId);
    if (!valid(verified) || verified.proposalId !== proposalId) {
      throw new Error("proposal verification returned invalid addresses");
    }
    const existing = this.proposals.find((entry) =>
      entry.proposalId === proposalId
    );
    if (!existing) {
      this.proposals.push(verified);
      this.proposals.sort((left, right) =>
        left.proposalId.localeCompare(right.proposalId)
      );
      save(this.stateFile, this.proposals);
    } else if (
      existing.market !== verified.market ||
      existing.liquidityVault !== verified.liquidityVault
    ) {
      throw new Error("proposal addresses changed after registration");
    }
    return { ...verified };
  }
}
