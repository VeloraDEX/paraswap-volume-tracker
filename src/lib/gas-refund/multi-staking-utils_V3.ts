import { GasRefundTransactionStakeSnapshotData_V3 } from '../../models/GasRefundTransactionStakeSnapshot_V3';
import { GasRefundTransactionData_V3 } from './gas-refund_V3';
import * as Sequelize from 'sequelize';
import BigNumber from 'bignumber.js';

import Database from '../../database';
import {
  BigNumberByEpochByChain,
  ComputationOptions,
  defaultRounder,
  toFixed,
} from './multi-staking-utils';

const QUERY_V3 = `
select
  grt.*, grtss.*
from
  "GasRefundTransaction_V3s" grt
left join "GasRefundTransactionStakeSnapshot_V3s" grtss on
  grt.hash = grtss."transactionHash"
  and grt."chainId" = grtss."transactionChainId"
  -- before Delta, staker field was missing in the GasRefundTransactionStakeSnapshots as txs were 1:1 with stakers
  and ((grtss.staker = grt.address) OR (grtss.staker is NULL))
where 
    grt.address = :address 
    and grt.epoch between :epochFrom and :epochTo
`;

type PickedStakeSnapshotData_V3 = Pick<
  GasRefundTransactionStakeSnapshotData_V3,
  | 'stakeChainId'
  | 'stakeScore'
  | 'bptXYZBalance'
  | 'bptTotalSupply'
  | 'seXYZBalance'
>;

type TransactionWithStakeChainScore_V3 = GasRefundTransactionData_V3 &
  PickedStakeSnapshotData_V3;

type TransactionWithStakeChainScoreByStakeChain_V3 =
  GasRefundTransactionData_V3 & {
    stakeByChain: Record<number, PickedStakeSnapshotData_V3>;
  };

//NB: running into a problem with null not converting into Bigint most likely means that some of the fetched txs don't have a StakeSnapshot match in the LEFT JOIN above
export async function loadTransactionWithByStakeChainData_V3({
  address,
  epochFrom,
  epochTo,
}: {
  address: string;
  epochFrom: number;
  epochTo: number;
}): Promise<TransactionWithStakeChainScoreByStakeChain_V3[]> {
  const rows =
    await Database.sequelize.query<TransactionWithStakeChainScore_V3>(
      QUERY_V3,
      {
        type: Sequelize.QueryTypes.SELECT,
        raw: true,
        replacements: {
          address,
          epochFrom,
          epochTo,
        },
      },
    );

  const withByStakeChain = rows.reduce<
    Record<string, TransactionWithStakeChainScoreByStakeChain_V3>
  >((acc, row) => {
    const {
      stakeChainId,
      stakeScore,
      bptXYZBalance,
      bptTotalSupply,
      seXYZBalance,

      ...originalTransaction
    } = row;
    const rowIdx = `${originalTransaction.chainId}-${originalTransaction.hash}`;
    const accumulatedRow = {
      ...originalTransaction,
      ...acc[rowIdx],
      stakeByChain: {
        ...acc[rowIdx]?.stakeByChain,
        [stakeChainId]: {
          stakeChainId,
          stakeScore,
          bptXYZBalance,
          bptTotalSupply,
          seXYZBalance,
        },
      },
    };
    return {
      ...acc,
      [rowIdx]: accumulatedRow,
    };
  }, {});

  const results = Object.values(withByStakeChain);
  return results;
}

type TransactionWithCaimableByStakeChain_V3 =
  TransactionWithStakeChainScoreByStakeChain_V3 & {
    claimableByStakeChain: { [chainId: number]: BigNumber };
  };

type ComputedAggregatedEpochData_V3 = {
  transactionsWithClaimable: TransactionWithCaimableByStakeChain_V3[];

  refundedByChain: { [chainId: number]: string };
  claimableByChain: { [chainId: number]: string };
};
type ComputeAggregatedStakeChainDetailsResult_V3 = {
  [epoch: number]: ComputedAggregatedEpochData_V3;
};

// beware, because the operations involve division, the Bignumbers returned would be with non-integers
export function computeAggregatedStakeChainDetails_V3(
  transactions: TransactionWithStakeChainScoreByStakeChain_V3[],
  options?: ComputationOptions,
): ComputeAggregatedStakeChainDetailsResult_V3 {
  const roundBignumber = options?.roundBignumber ?? defaultRounder;

  const refundedByEpochByChain = transactions.reduce<BigNumberByEpochByChain>(
    (acc, tx) => {
      if (!acc[tx.epoch]) acc[tx.epoch] = {};
      if (!acc[tx.epoch][tx.chainId])
        acc[tx.epoch][tx.chainId] = new BigNumber(0);
      acc[tx.epoch][tx.chainId] = acc[tx.epoch][tx.chainId].plus(
        tx.refundedAmountVLR,
      );
      return acc;
    },
    {},
  );

  const transactionsWithClaimableByChain: TransactionWithCaimableByStakeChain_V3[] =
    transactions.map(tx => {
      const sumStakeScore = Object.values(tx.stakeByChain).reduce(
        (acc, stake) => {
          const stakeScore = stake.stakeScore || '0';
          if (!stake.stakeScore)
            console.log(
              `stakeScore is null for tx ${tx.hash} on chain ${tx.chainId} of user ${tx.address}`,
            );
          return acc + BigInt(stakeScore);
        },
        BigInt(0),
      );

      const claimableByStakeChainForTx: Record<number, BigNumber> =
        Object.values(tx.stakeByChain).reduce(
          (acc, stake) => ({
            ...acc,
            [stake.stakeChainId]: roundBignumber(
              new BigNumber(stake.stakeScore)
                .div(sumStakeScore.toString())
                .multipliedBy(tx.refundedAmountVLR),
            ),
          }),
          {},
        );

      return {
        ...tx,
        claimableByStakeChain: claimableByStakeChainForTx,
      };
    });

  const claimableByEpochByChain = transactionsWithClaimableByChain.reduce<{
    [epoch: number]: { [chainId: number]: BigNumber };
  }>((acc, tx) => {
    Object.entries(tx.claimableByStakeChain).forEach(
      ([stakeChainId, claimable]) => {
        const chainId = Number(stakeChainId);
        if (!acc[tx.epoch]) acc[tx.epoch] = {};

        if (!acc[tx.epoch][chainId]) {
          acc[tx.epoch][chainId] = claimable;
        } else {
          acc[tx.epoch][chainId] = acc[tx.epoch][chainId].plus(claimable);
        }
      },
    );
    return acc;
  }, {});

  const transactionsWithClaimableByEpoch =
    transactionsWithClaimableByChain.reduce<{
      [epoch: number]: TransactionWithCaimableByStakeChain_V3[];
    }>((acc, curr) => {
      if (!acc[curr.epoch]) acc[curr.epoch] = [];
      acc[curr.epoch].push(curr);
      return acc;
    }, {});

  const entries: [number, ComputedAggregatedEpochData_V3][] = Object.keys(
    transactionsWithClaimableByEpoch,
  ).map(_epoch => {
    const epoch = Number(_epoch);
    return [
      epoch,
      {
        transactionsWithClaimable: transactionsWithClaimableByEpoch[epoch],

        refundedByChain: toFixed(refundedByEpochByChain[epoch]),
        claimableByChain: toFixed(claimableByEpochByChain[epoch]),
      },
    ];
  });
  const byEpoch = Object.fromEntries(entries);

  return byEpoch;
}
