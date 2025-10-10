import { GasRefundTransactionData_V3 } from '../../../src/lib/gas-refund/gas-refund_V3';
import { ExtendedCovalentGasRefundTransaction } from '../../../src/types-from-scripts';

import { StakedScoreV3 } from '../staking/stakes-tracker_V3';

export type GasRefundTransactionDataWithStakeScore_V3 =
  GasRefundTransactionData_V3 & {
    stakeScore: StakedScoreV3;
  };

export type TxProcessorFn_V3 = (
  transactions: ExtendedCovalentGasRefundTransaction[],
  computeRefundPercent: (
    epoch: number,
    totalVLRorTotalParaboostScore: string,
  ) => number | undefined,
) => Promise<GasRefundTransactionDataWithStakeScore_V3[]>;
