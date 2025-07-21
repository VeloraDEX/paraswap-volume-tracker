import BigNumber from 'bignumber.js';
import { Op, Sequelize } from 'sequelize';
import { TransactionStatus } from '../../../src/lib/gas-refund/gas-refund';
import {
  GasRefundTransactionStakeSnapshot_V3,
  GasRefundTransactionStakeSnapshotData_V3,
} from '../../../src/models/GasRefundTransactionStakeSnapshot_V3';
import { GasRefundTransaction_V3 } from '../../../src/models/GasRefundTransaction_V3';
import { StakedScoreV3 } from '../staking/stakes-tracker_V3';
import { GasRefundTransactionData_V3 } from '../../../src/lib/gas-refund/gas-refund_V3';

const logger = global.LOGGER('db-persistence-v3');

export async function fetchLastTimestampTxByContract_V3({
  chainId,
  epoch,
}: {
  chainId: number;
  epoch: number;
}): Promise<{ [contract: string]: number }> {
  const totalRefundedAmountUSDAllAddresses =
    (await GasRefundTransaction_V3.findAll({
      attributes: [
        'contract',
        [Sequelize.fn('MAX', Sequelize.col('timestamp')), 'latestTimestamp'],
      ],
      where: {
        chainId,
        epoch,
      },
      group: 'contract',
      raw: true,
    })) as unknown as { contract: string; latestTimestamp: number }[];

  return Object.fromEntries(
    totalRefundedAmountUSDAllAddresses.map(
      ({ contract, latestTimestamp }) => [contract, latestTimestamp] as const,
    ),
  );
}

export async function fetchTotalRefundedVLR_V3(
  startEpoch: number,
  toEpoch?: number,
): Promise<BigNumber> {
  const totalVLRRefunded = (await GasRefundTransaction_V3.sum<
    string,
    GasRefundTransaction_V3
  >('refundedAmountVLR', {
    where: {
      status: TransactionStatus.VALIDATED,
      epoch: {
        [Op.gte]: startEpoch,
        ...(toEpoch ? { [Op.lt]: toEpoch } : {}),
      },
    },
    dataType: 'string',
  })) as unknown as string | number; // wrong type

  return new BigNumber(totalVLRRefunded);
}

export async function fetchTotalRefundedAmountUSDByAddress_V3(
  startEpoch: number,
  toEpoch?: number,
): Promise<{
  [address: string]: BigNumber;
}> {
  const totalRefundedAmountUSDAllAddresses =
    (await GasRefundTransaction_V3.findAll({
      attributes: [
        'address',
        [
          Sequelize.fn('SUM', Sequelize.col('refundedAmountUSD')),
          'totalRefundedAmountUSD',
        ],
      ],
      where: {
        status: TransactionStatus.VALIDATED,
        epoch: {
          [Op.gte]: startEpoch,
          ...(toEpoch ? { [Op.lt]: toEpoch } : {}),
        },
      },
      group: 'address',
      raw: true,
    })) as unknown as { address: string; totalRefundedAmountUSD: string }[];

  const totalRefundedAmountUSDByAddress = Object.fromEntries(
    totalRefundedAmountUSDAllAddresses.map(
      ({ address, totalRefundedAmountUSD }) =>
        [address, new BigNumber(totalRefundedAmountUSD)] as const,
    ),
  );

  return totalRefundedAmountUSDByAddress;
}

export const writeTransactions_V3 = async (
  newRefundableTransactions: GasRefundTransactionData_V3[],
) => {
  for (const transaction of newRefundableTransactions) {
    try {
      await GasRefundTransaction_V3.create(transaction);
      logger.info(`Transaction created: ${JSON.stringify(transaction)}`);
    } catch (error) {
      logger.error(
        `Error creating transaction: ${JSON.stringify(transaction)}`,
        error,
      );
      throw error;
    }
  }
};

export const updateTransactionsStatusRefundedAmounts_V3 = async (
  transactionsWithNewStatus: GasRefundTransactionData_V3[],
) => {
  await GasRefundTransaction_V3.bulkCreate(transactionsWithNewStatus, {
    updateOnDuplicate: [
      'status',
      'refundedAmountUSD',
      'refundedAmountVLR',
      'paraBoostFactor',
    ],
  });
};

export function composeGasRefundTransactionStakeSnapshots_V3(
  transaction: GasRefundTransactionData_V3,
  stakeScore: StakedScoreV3,
): GasRefundTransactionStakeSnapshotData_V3[] {
  return Object.entries(stakeScore.byNetwork).map(([chainId, score]) => ({
    transactionChainId: transaction.chainId,
    transactionHash: transaction.hash,
    stakeChainId: Number(chainId),
    stakeScore: score?.stakeScore || '0',
    seXYZBalance: score?.seXYZBalance || '0',
    bptTotalSupply: score?.bptTotalSupply || '0',
    bptXYZBalance: score?.bptXYZBalance || '0',
    staker: transaction.address,
  }));
}

export async function writeStakeScoreSnapshots_V3(
  items: GasRefundTransactionStakeSnapshotData_V3[],
) {
  const indices = items.map(item => Object.values(item).join(','));
  const unique = new Set<string>(indices);
  if (unique.size !== items.length) {
    // throw new Error('Duplicated items in stake score snapshots');

    const dupes = indices.filter(
      (item, index) => indices.indexOf(item) != index,
    );
    debugger;
    throw new Error(`Duplicated items in v3 stake score snapshots: ${dupes}`);
  }

  for (const item of items) {
    try {
      await GasRefundTransactionStakeSnapshot_V3.create(item);
      logger.info(`V3 Snapshot created or updated: ${JSON.stringify(item)}`);
    } catch (error) {
      logger.error(
        `Error creating or updating V3 snapshot: ${JSON.stringify(item)}`,
        error,
      );
    }
  }
}
