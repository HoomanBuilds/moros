export const FIXED_SCALE = 1n << 32n;
export const ATOMIC_SCALE = 10_000_000n;
export const LN2_FIXED = 2_977_044_472n;
export const BPS_SCALE = 10_000n;

function requireNonNegative(name, value) {
  if (typeof value !== "bigint" || value < 0n) {
    throw new Error(`${name} must be a nonnegative bigint`);
  }
}

function requirePositive(name, value) {
  if (typeof value !== "bigint" || value <= 0n) {
    throw new Error(`${name} must be a positive bigint`);
  }
}

function multiplyFixed(a, b) {
  return a * b / FIXED_SCALE;
}

function divideFixed(a, b) {
  if (b === 0n) throw new Error("fixed-point division by zero");
  return a * FIXED_SCALE / b;
}

function expFixed(x) {
  let k = x / LN2_FIXED;
  let remainder = x - k * LN2_FIXED;
  if (remainder > LN2_FIXED / 2n) {
    k += 1n;
    remainder -= LN2_FIXED;
  }
  if (remainder < -LN2_FIXED / 2n) {
    k -= 1n;
    remainder += LN2_FIXED;
  }

  let term = FIXED_SCALE;
  let sum = FIXED_SCALE;
  for (let n = 1n; n <= 12n; n += 1n) {
    term = multiplyFixed(term, remainder) / n;
    sum += term;
  }

  if (k >= 0n) return sum << k;
  return sum >> -k;
}

function logFixed(x) {
  requirePositive("log input", x);
  let normalized = x;
  let exponent = 0n;
  while (normalized >= 2n * FIXED_SCALE) {
    normalized >>= 1n;
    exponent += 1n;
  }
  while (normalized < FIXED_SCALE) {
    normalized <<= 1n;
    exponent -= 1n;
  }

  const u = divideFixed(normalized - FIXED_SCALE, normalized + FIXED_SCALE);
  const uSquared = multiplyFixed(u, u);
  let numerator = u;
  let sum = u;
  for (let denominator = 3n; denominator <= 13n; denominator += 2n) {
    numerator = multiplyFixed(numerator, uSquared);
    sum += numerator / denominator;
  }
  return (sum << 1n) + exponent * LN2_FIXED;
}

export function lmsrCost(qYes, qNo, b) {
  requireNonNegative("qYes", qYes);
  requireNonNegative("qNo", qNo);
  requirePositive("b", b);
  const yes = divideFixed(qYes, b);
  const no = divideFixed(qNo, b);
  const maximum = yes > no ? yes : no;
  const exponentSum = expFixed(yes - maximum) + expFixed(no - maximum);
  return multiplyFixed(b, maximum) + multiplyFixed(b, logFixed(exponentSum));
}

export function yesPrice(qYes, qNo, b) {
  requireNonNegative("qYes", qYes);
  requireNonNegative("qNo", qNo);
  requirePositive("b", b);
  const yes = divideFixed(qYes, b);
  const no = divideFixed(qNo, b);
  const maximum = yes > no ? yes : no;
  const yesWeight = expFixed(yes - maximum);
  const noWeight = expFixed(no - maximum);
  return divideFixed(yesWeight, yesWeight + noWeight);
}

function softplusFixed(value) {
  const maximum = value > 0n ? value : 0n;
  return maximum + logFixed(expFixed(value - maximum) + expFixed(-maximum));
}

function averageYesPrice(qYes, qNo, deltaYes, deltaNo, b) {
  const zStart = divideFixed(qYes - qNo, b);
  const zDelta = divideFixed(deltaYes - deltaNo, b);
  if (zDelta === 0n) return yesPrice(qYes, qNo, b);
  const price = divideFixed(
    softplusFixed(zStart + zDelta) - softplusFixed(zStart),
    zDelta,
  );
  if (price < 0n) return 0n;
  if (price > FIXED_SCALE) return FIXED_SCALE;
  return price;
}

function toAtomicDown(fixed) {
  requireNonNegative("fixed amount", fixed);
  return fixed * ATOMIC_SCALE / FIXED_SCALE;
}

function toAtomicUp(fixed) {
  requireNonNegative("fixed amount", fixed);
  if (fixed === 0n) return 0n;
  return (fixed * ATOMIC_SCALE + FIXED_SCALE - 1n) / FIXED_SCALE;
}

export function initialLossAtomic(b) {
  requirePositive("b", b);
  return toAtomicUp(multiplyFixed(b, LN2_FIXED));
}

export function deriveLiquidityParameter(targetAtomic, initializationReserveAtomic = 0n) {
  requirePositive("targetAtomic", targetAtomic);
  requireNonNegative("initializationReserveAtomic", initializationReserveAtomic);
  if (initializationReserveAtomic >= targetAtomic) {
    throw new Error("initialization reserve consumes the funding target");
  }
  const lossBudget = targetAtomic - initializationReserveAtomic;
  const maximumCostFixed = lossBudget * FIXED_SCALE / ATOMIC_SCALE;
  const b = ((maximumCostFixed + 1n) * FIXED_SCALE - 1n) / LN2_FIXED;
  if (b <= 0n || initialLossAtomic(b) > lossBudget) {
    throw new Error("funding target cannot support a positive liquidity parameter");
  }
  return {
    b,
    initialLoss: initialLossAtomic(b),
    initializationReserve: initializationReserveAtomic,
    unused: targetAtomic - initializationReserveAtomic - initialLossAtomic(b),
  };
}

function allocateAggregateCost(total, yesWeight, noWeight) {
  const denominator = yesWeight + noWeight;
  if (denominator <= 0n) throw new Error("batch has no positive side cost");
  const yesBase = total * yesWeight / denominator;
  const noBase = total * noWeight / denominator;
  let remaining = total - yesBase - noBase;
  if (remaining < 0n || remaining > 1n) {
    throw new Error("side allocation remainder is outside its bound");
  }

  let yes = yesBase;
  let no = noBase;
  if (remaining === 1n) {
    const yesRemainder = total * yesWeight % denominator;
    const noRemainder = total * noWeight % denominator;
    if (yesRemainder >= noRemainder) yes += 1n;
    else no += 1n;
    remaining = 0n;
  }
  return { yes, no };
}

function feePerPositionAtomic(lot, price, feeRateBps) {
  if (feeRateBps < 0n || feeRateBps > BPS_SCALE) {
    throw new Error("fee rate is outside basis-point bounds");
  }
  const risk = multiplyFixed(price, FIXED_SCALE - price);
  const rate = feeRateBps * FIXED_SCALE / BPS_SCALE;
  return toAtomicUp(multiplyFixed(multiplyFixed(lot, risk), rate));
}

export function allocateBatch({
  qYes,
  qNo,
  b,
  lot,
  yesCount,
  noCount,
  feeRateBps,
}) {
  requireNonNegative("qYes", qYes);
  requireNonNegative("qNo", qNo);
  requirePositive("b", b);
  requirePositive("lot", lot);
  requirePositive("yesCount", yesCount);
  requirePositive("noCount", noCount);
  if (yesCount < 2n || noCount < 2n || yesCount + noCount < 8n) {
    throw new Error("private batch does not satisfy its privacy floor");
  }

  const deltaYes = yesCount * lot;
  const deltaNo = noCount * lot;
  const before = lmsrCost(qYes, qNo, b);
  const after = lmsrCost(qYes + deltaYes, qNo + deltaNo, b);
  const aggregateMarketCharge = toAtomicUp(after - before);
  const preYesPrice = yesPrice(qYes, qNo, b);
  const postYesPrice = yesPrice(qYes + deltaYes, qNo + deltaNo, b);
  const uniformYesPrice = averageYesPrice(qYes, qNo, deltaYes, deltaNo, b);
  const uniformNoPrice = FIXED_SCALE - uniformYesPrice;
  const yesWeight = multiplyFixed(deltaYes, uniformYesPrice);
  const noWeight = multiplyFixed(deltaNo, uniformNoPrice);
  const sideCosts = allocateAggregateCost(
    aggregateMarketCharge,
    yesWeight,
    noWeight,
  );
  const yesChargePerPosition = sideCosts.yes / yesCount;
  const noChargePerPosition = sideCosts.no / noCount;
  const roundingContribution =
    sideCosts.yes - yesChargePerPosition * yesCount
    + sideCosts.no - noChargePerPosition * noCount;
  const feePerPosition = feePerPositionAtomic(lot, uniformYesPrice, feeRateBps);
  const batchSize = yesCount + noCount;
  const feeEscrow = feePerPosition * batchSize;

  if (roundingContribution < 0n || roundingContribution >= batchSize) {
    throw new Error("batch rounding contribution is outside its bound");
  }
  if (feeEscrow < roundingContribution) {
    throw new Error("fee escrow cannot reimburse batch rounding");
  }

  return {
    batchSize,
    yesCount,
    noCount,
    preYesPrice,
    postYesPrice,
    yesPrice: uniformYesPrice,
    noPrice: uniformNoPrice,
    aggregateMarketCharge,
    yesMarketCost: sideCosts.yes,
    noMarketCost: sideCosts.no,
    yesChargePerPosition,
    noChargePerPosition,
    roundingContribution,
    feePerPosition,
    feeEscrow,
  };
}

export function mintFundingShares({
  deposit,
  fundedAssets,
  totalShares,
  virtualAssets,
  virtualShares,
}) {
  requirePositive("deposit", deposit);
  requireNonNegative("fundedAssets", fundedAssets);
  requireNonNegative("totalShares", totalShares);
  requirePositive("virtualAssets", virtualAssets);
  requirePositive("virtualShares", virtualShares);
  const shares = deposit * (totalShares + virtualShares)
    / (fundedAssets + virtualAssets);
  if (shares <= 0n) throw new Error("deposit would mint zero shares");
  return shares;
}

export function burnFundingShares({ shares, fundedAssets, totalShares }) {
  requirePositive("shares", shares);
  requireNonNegative("fundedAssets", fundedAssets);
  requirePositive("totalShares", totalShares);
  if (shares > totalShares) throw new Error("cannot burn more than total shares");
  if (shares === totalShares) return fundedAssets;
  return shares * fundedAssets / totalShares;
}

export function scenarioEquity({
  marketAssets,
  yesLiability,
  noLiability,
  conditionalLpFee,
}) {
  requireNonNegative("marketAssets", marketAssets);
  requireNonNegative("yesLiability", yesLiability);
  requireNonNegative("noLiability", noLiability);
  requireNonNegative("conditionalLpFee", conditionalLpFee);
  const ifYes = marketAssets - yesLiability + conditionalLpFee;
  const ifNo = marketAssets - noLiability + conditionalLpFee;
  if (ifYes < 0n || ifNo < 0n) throw new Error("insolvent market scenario");
  return {
    ifYes,
    ifNo,
    floor: ifYes < ifNo ? ifYes : ifNo,
    ceiling: ifYes > ifNo ? ifYes : ifNo,
  };
}

export function splitVestedFee({
  feeEscrow,
  roundingReimbursement,
  lpSplitBps,
}) {
  requireNonNegative("feeEscrow", feeEscrow);
  requireNonNegative("roundingReimbursement", roundingReimbursement);
  requireNonNegative("lpSplitBps", lpSplitBps);
  if (lpSplitBps > BPS_SCALE) throw new Error("LP fee split is outside bounds");
  if (roundingReimbursement > feeEscrow) {
    throw new Error("rounding reimbursement exceeds fee escrow");
  }
  const distributable = feeEscrow - roundingReimbursement;
  const lpFee = distributable * lpSplitBps / BPS_SCALE;
  return {
    roundingReimbursement,
    distributable,
    lpFee,
    protocolFee: distributable - lpFee,
  };
}

export function fillExit({
  sharesRemaining,
  sharesRequested,
  minimumTotalPayment,
  payment,
}) {
  requirePositive("sharesRemaining", sharesRemaining);
  requirePositive("sharesRequested", sharesRequested);
  requireNonNegative("minimumTotalPayment", minimumTotalPayment);
  requireNonNegative("payment", payment);
  if (sharesRequested > sharesRemaining) throw new Error("exit fill is too large");
  const minimumPayment =
    (minimumTotalPayment * sharesRequested + sharesRemaining - 1n)
    / sharesRemaining;
  if (payment < minimumPayment) throw new Error("exit payment is below minimum");
  return {
    sharesTransferred: sharesRequested,
    sharesRemaining: sharesRemaining - sharesRequested,
    sellerPayment: payment,
  };
}

export function terminalRedeem({ shares, remainingAssets, remainingShares }) {
  requirePositive("shares", shares);
  requireNonNegative("remainingAssets", remainingAssets);
  requirePositive("remainingShares", remainingShares);
  if (shares > remainingShares) throw new Error("redemption exceeds share supply");
  if (shares === remainingShares) return remainingAssets;
  return shares * remainingAssets / remainingShares;
}
