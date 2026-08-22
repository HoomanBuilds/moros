const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytes(value, label) {
  if (!(value instanceof Uint8Array)) throw new Error(`invalid ${label}`);
  return value;
}

export function bytesToHex(value) {
  return [...bytes(value, "byte value")]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function bytesToBase64(value) {
  const input = bytes(value, "byte value");
  let output = "";
  for (let index = 0; index < input.length; index += 3) {
    const first = input[index];
    const second = input[index + 1];
    const third = input[index + 2];
    const combined = (first << 16) | ((second || 0) << 8) | (third || 0);
    output += BASE64[(combined >>> 18) & 63];
    output += BASE64[(combined >>> 12) & 63];
    output += second === undefined ? "=" : BASE64[(combined >>> 6) & 63];
    output += third === undefined ? "=" : BASE64[combined & 63];
  }
  return output;
}

export function bytesToBase64Url(value) {
  return bytesToBase64(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function base64UrlToBytes(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("invalid base64url value");
  }
  const standard = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = standard + "=".repeat((4 - standard.length % 4) % 4);
  const output = [];
  for (let index = 0; index < padded.length; index += 4) {
    const values = [...padded.slice(index, index + 4)].map((character) =>
      character === "=" ? 0 : BASE64.indexOf(character));
    if (values.some((item) => item < 0)) throw new Error("invalid base64url value");
    const combined = (values[0] << 18) | (values[1] << 12) | (values[2] << 6) | values[3];
    output.push((combined >>> 16) & 255);
    if (padded[index + 2] !== "=") output.push((combined >>> 8) & 255);
    if (padded[index + 3] !== "=") output.push(combined & 255);
  }
  const decoded = Uint8Array.from(output);
  if (bytesToBase64Url(decoded) !== value) throw new Error("invalid base64url value");
  return decoded;
}
