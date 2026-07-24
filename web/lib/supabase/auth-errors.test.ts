import assert from "node:assert/strict";
import { isExistingUserError } from "./auth-errors.ts";

assert.equal(isExistingUserError({ code: "email_exists", message: "ignored" }), true);
assert.equal(isExistingUserError({ code: "USER_ALREADY_EXISTS", message: "ignored" }), true);
assert.equal(
  isExistingUserError({
    message: "A user with this email address has already been registered",
  }),
  true,
);
assert.equal(isExistingUserError({ message: "User already registered" }), true);
assert.equal(isExistingUserError({ message: "Database error creating new user" }), false);
assert.equal(isExistingUserError(null), false);

console.log("supabase auth errors ok");
