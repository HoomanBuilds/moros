import assert from "node:assert/strict";
import { canonicalEventRules, eventRulesHashHex, stellarStringHashHex } from "./rules";

const rules = {
  title: "  Will Team A win?  ",
  category: "Sports",
  resolutionSource: " https://league.example/results ",
  resolutionRules: " Team A is listed as the official winner. ",
  voidRules: " The match is cancelled and not replayed by the cutoff. ",
};

assert.equal(
  canonicalEventRules(rules),
  '{"title":"Will Team A win?","category":"Sports","resolutionSource":"https://league.example/results","resolutionRules":"Team A is listed as the official winner.","voidRules":"The match is cancelled and not replayed by the cutoff."}',
);
assert.equal(eventRulesHashHex(rules).length, 64);
assert.equal(eventRulesHashHex(rules), eventRulesHashHex({ ...rules, title: "Will Team A win?" }));
assert.notEqual(eventRulesHashHex(rules), eventRulesHashHex({ ...rules, title: "Will Team B win?" }));
assert.equal(stellarStringHashHex("https://source.example/result").length, 64);
assert.notEqual(stellarStringHashHex("https://source.example/result"), eventRulesHashHex(rules));

const rulesWithBackups = {
  ...rules,
  backupResolutionSources: [
    " https://backup-one.example/result ",
    "https://backup-two.example/result",
    "https://backup-one.example/result",
  ],
};
assert.equal(
  canonicalEventRules(rulesWithBackups),
  '{"title":"Will Team A win?","category":"Sports","resolutionSource":"https://league.example/results","resolutionRules":"Team A is listed as the official winner.","voidRules":"The match is cancelled and not replayed by the cutoff.","backupResolutionSources":["https://backup-one.example/result","https://backup-two.example/result"]}',
);
assert.notEqual(eventRulesHashHex(rules), eventRulesHashHex(rulesWithBackups));
assert.notEqual(
  eventRulesHashHex(rulesWithBackups),
  eventRulesHashHex({ ...rulesWithBackups, backupResolutionSources: ["https://backup-two.example/result"] }),
);

console.log("market rules ok");
