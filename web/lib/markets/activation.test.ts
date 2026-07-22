import assert from "node:assert";
import { activateMarket, type ActivationStage } from "./activation.ts";

async function main() {
  const calls: string[] = [];
  await activateMarket({
    register: async () => { calls.push("register"); },
    save: async () => { calls.push("save"); return true; },
    onStage: (stage) => { calls.push(stage); },
  });
  assert.deepEqual(calls, ["registration", "register", "listing", "save"]);

  const rejectedStages: ActivationStage[] = [];
  let savedAfterRejection = false;
  await assert.rejects(
    activateMarket({
      register: async () => { throw new Error("committee unavailable"); },
      save: async () => { savedAfterRejection = true; return true; },
      onStage: (stage) => { rejectedStages.push(stage); },
    }),
    /committee unavailable/,
  );
  assert.deepEqual(rejectedStages, ["registration"]);
  assert.equal(savedAfterRejection, false);

  await assert.rejects(
    activateMarket({
      register: async () => {},
      save: async () => false,
      onStage: () => {},
    }),
    /public registry rejected the listing.*Retry market setup/,
  );

  await assert.rejects(
    activateMarket({
      register: async () => {},
      save: async () => { throw new Error("database rejected field 23514"); },
      onStage: () => {},
    }),
    /database rejected field 23514/,
  );

  console.log("market activation flow ok");
}

void main();
