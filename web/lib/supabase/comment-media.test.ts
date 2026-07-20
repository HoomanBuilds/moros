import assert from "node:assert";
import {
  COMMENT_IMAGE_MAX_BYTES,
  commentImageExtension,
  commentImagePath,
  isOwnedCommentImagePath,
  validateCommentImage,
} from "./comment-media.ts";

assert.equal(validateCommentImage({ type: "image/png", size: 100 }), null);
assert.equal(validateCommentImage({ type: "image/gif", size: COMMENT_IMAGE_MAX_BYTES }), null);
assert.match(validateCommentImage({ type: "image/svg+xml", size: 100 }) ?? "", /JPEG/);
assert.match(validateCommentImage({ type: "image/png", size: 0 }) ?? "", /empty/);
assert.match(validateCommentImage({ type: "image/png", size: COMMENT_IMAGE_MAX_BYTES + 1 }) ?? "", /5 MB/);
assert.equal(commentImageExtension("image/webp"), "webp");
assert.equal(commentImageExtension("text/plain"), null);
assert.equal(
  commentImagePath("GABC", "market/id", "image/jpeg", "image id"),
  "GABC/marketid/imageid.jpg",
);
assert.equal(commentImagePath("GABC", "///", "image/jpeg", "id"), null);
assert.equal(isOwnedCommentImagePath("GABC/market/image.png", "GABC"), true);
assert.equal(isOwnedCommentImagePath("GOTHER/market/image.png", "GABC"), false);
assert.equal(isOwnedCommentImagePath("GABC/market/../../image.png", "GABC"), false);
assert.equal(isOwnedCommentImagePath("javascript:alert(1)", "GABC"), false);

console.log("comment media ok");
