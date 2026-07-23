import assert from "node:assert/strict";
import { resolveArchiveVault } from "./backup-vault";

const configured = `C${"A".repeat(55)}`;
const deployed = `C${"B".repeat(55)}`;

assert.equal(resolveArchiveVault(configured, deployed), configured);
assert.equal(resolveArchiveVault(undefined, deployed), deployed);
assert.throws(() => resolveArchiveVault(undefined, undefined), /not configured/);
assert.throws(() => resolveArchiveVault("bad", deployed), /not configured/);

console.log("private archive vault selection ok");
