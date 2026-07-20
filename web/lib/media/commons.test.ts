import assert from "node:assert/strict";
import { isCommonsDownloadUrl, searchCommonsImages } from "./commons";

assert.equal(isCommonsDownloadUrl("https://upload.wikimedia.org/file.png"), true);
assert.equal(isCommonsDownloadUrl("http://upload.wikimedia.org/file.png"), false);
assert.equal(isCommonsDownloadUrl("https://example.com/file.png"), false);

let requestedUrl = "";
const fetcher = (async (input: string | URL | Request) => {
  requestedUrl = String(input);
  return new Response(JSON.stringify({
    query: {
      pages: [
        {
          pageid: 7,
          title: "File:Example_team.svg",
          fullurl: "https://commons.wikimedia.org/wiki/File:Example_team.svg",
          imageinfo: [{
            thumburl: "https://upload.wikimedia.org/example.png",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Example_team.svg",
            thumbmime: "image/png",
            extmetadata: {
              Artist: { value: "<b>Jane &amp; John</b>" },
              LicenseShortName: { value: "CC BY-SA 4.0" },
              LicenseUrl: { value: "https://creativecommons.org/licenses/by-sa/4.0/" },
            },
          }],
        },
        {
          pageid: 8,
          title: "File:Unsafe.png",
          imageinfo: [{
            thumburl: "https://example.com/unsafe.png",
            descriptionurl: "https://commons.wikimedia.org/wiki/File:Unsafe.png",
            thumbmime: "image/png",
          }],
        },
      ],
    },
  }), { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

async function main() {
  const results = await searchCommonsImages("Example team", { fetcher });
  assert.equal(results.length, 1);
  assert.equal(results[0].title, "Example team");
  assert.equal(results[0].attribution, "Jane & John");
  assert.equal(results[0].license, "CC BY-SA 4.0");
  assert.ok(requestedUrl.includes("gsrsearch=Example+team"));
  assert.deepEqual(await searchCommonsImages(" ", { fetcher }), []);

  console.log("commons media ok");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
