import assert from "node:assert/strict";
import { copyBrowserText, shareBrowserText } from "./browser-share";

async function main() {
  const copied: string[] = [];
  const clipboard = { writeText: async (value: string) => { copied.push(value); } };

  await copyBrowserText("moros_pay_test", { clipboard });
  assert.deepEqual(copied, ["moros_pay_test"]);

  assert.equal(await shareBrowserText({ url: "https://pay.moros.fun/pay#test" }, { clipboard }), "copied");
  assert.equal(copied.at(-1), "https://pay.moros.fun/pay#test");

  let shared = false;
  assert.equal(await shareBrowserText({ text: "private code" }, {
    clipboard,
    share: async () => { shared = true; },
  }), "shared");
  assert.equal(shared, true);

  const cancellation = new Error("cancelled");
  cancellation.name = "AbortError";
  assert.equal(await shareBrowserText({ text: "private code" }, {
    share: async () => { throw cancellation; },
  }), "cancelled");

  await assert.rejects(() => copyBrowserText("test", {}), /unavailable/);
  await assert.rejects(() => copyBrowserText("", { clipboard }), /nothing to copy/);
}

void main();
