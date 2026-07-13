import assert from "node:assert";
import { supabaseEnabled } from "./config.ts";
assert.equal(typeof supabaseEnabled(), "boolean");
assert.equal(supabaseEnabled(), false);
console.log("supabase config ok");
