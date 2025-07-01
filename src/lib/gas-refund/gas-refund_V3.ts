import { GRP_MAX_REFUND_PERCENT, GRP_MIN_REFUND_ALLOWED, TransactionStatus } from "./gas-refund";

// TODO: change it to 57. Had 56 here to test previous distribution as if it was already done on v3 staking system
export const GasRefundV3EpochFlip = 56;


export interface GasRefundTransactionData_V3 {
  epoch: number;
  address: string;
  chainId: number;
  hash: string;
  block: number;
  timestamp: number;
  gasUsedUSD: string;
  vlrUsd: number;
  totalStakeAmountVLR: string;
  refundedAmountVLR: string;
  refundedAmountUSD: string;
  contract: string;
  status: TransactionStatus;
  paraBoostFactor: number;
}


export const grpV3Func = (x: number): number => {
  const rawRefundPecent = 0.152003 * Math.log(0.000517947 * x);

  const cappedRefundPercent = Math.min(rawRefundPecent, GRP_MAX_REFUND_PERCENT);

  // TODO: if it's less than 0.25, return 0.25 --> for test purposes for now
  const cappedRefundPercentWithMin = Math.max(
    cappedRefundPercent,
    GRP_MIN_REFUND_ALLOWED,
  );
  return cappedRefundPercentWithMin;
};

export const getRefundPercentV3 = (score: string): number => {
  const scoreNorm = +(BigInt(score) / BigInt(10 ** 18)).toString();
  const refundPercent = grpV3Func(scoreNorm);
  return refundPercent;
};
