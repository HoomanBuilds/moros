import assert from "node:assert/strict";
import { legacyPredictDestination } from "./legacy-predict-redirect";

assert.equal(
  legacyPredictDestination("https://moros.fun/app/market/ABC?tab=comments"),
  "https://predict.moros.fun/app/market/ABC?tab=comments",
);
assert.equal(
  legacyPredictDestination("https://www.moros.fun/app/portfolio"),
  "https://predict.moros.fun/app/portfolio",
);
assert.equal(
  legacyPredictDestination(
    "http://127.0.0.1:3000/app/portfolio?filter=settled",
    "moros.fun:443",
  ),
  "https://predict.moros.fun/app/portfolio?filter=settled",
);
assert.equal(
  legacyPredictDestination(
    "http://127.0.0.1:3000/app",
    "moros.fun, internal-proxy.local",
  ),
  "https://predict.moros.fun/app",
);
assert.equal(legacyPredictDestination("https://predict.moros.fun/app"), null);
assert.equal(
  legacyPredictDestination("https://predict.moros.fun/app", "predict.moros.fun"),
  null,
);
assert.equal(legacyPredictDestination("https://moros-six.vercel.app/app"), null);
assert.equal(legacyPredictDestination("https://moros.fun/"), null);
assert.equal(legacyPredictDestination("https://moros.fun/application"), null);

console.log("legacy prediction redirect tests passed");
