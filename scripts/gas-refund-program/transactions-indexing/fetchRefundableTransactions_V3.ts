import { assert } from 'ts-essentials';
import { BigNumber } from 'bignumber.js';
import { getContractAddresses } from './transaction-resolver';
import {
  TransactionStatus,
  GasRefundV2EpochFlip,
  getMinStake,
  GasRefundV2PIP55,
} from '../../../src/lib/gas-refund/gas-refund';

import { isTruthy } from '../../../src/lib/utils';
import {
  AUGUSTUS_SWAPPERS_V6_OMNICHAIN,
  AUGUSTUS_V5_ADDRESS,
} from '../../../src/lib/constants';
import { ExtendedCovalentGasRefundTransaction } from '../../../src/types-from-scripts';
import type { Logger } from 'log4js';

import {
  composeGasRefundTransactionStakeSnapshots_V3,
  fetchLastTimestampTxByContract_V3,
  writeStakeScoreSnapshots_V3,
  writeTransactions_V3,
} from '../persistance/db-persistance_V3';
import {
  GasRefundTransactionDataWithStakeScore_V3,
  TxProcessorFn_V3,
} from './types_V3';
import StakesTracker_V3 from '../staking/stakes-tracker_V3';
import { getRefundPercentV3 } from '../../../src/lib/gas-refund/gas-refund_V3';
import { fetchParaswapV6StakersTransactions_V3 } from '../../../src/lib/paraswap-v6-stakers-transactions_v3';
import { PriceResolverFn_V3 } from '../token-pricing/vlr-chaincurrency-pricing';

function constructTransactionsProcessor_V3({
  chainId,
  epoch,
  resolvePrice,
}: {
  chainId: number;
  epoch: number;
  resolvePrice: PriceResolverFn_V3;
}): TxProcessorFn_V3 {
  return async function filterAndFormatRefundableTransactions_V3(
    transactions: ExtendedCovalentGasRefundTransaction[],
    computeRefundPercent: (
      epoch: number,
      totalVLRorTotalParaboostScore: string,
    ) => number | undefined,
  ) {
    const refundableTransactions: GasRefundTransactionDataWithStakeScore_V3[] =
      transactions
        .map(transaction => {
          const address = transaction.txOrigin;

          const stakeScore = StakesTracker_V3.getInstance().computeStakeScore(
            address,
            +transaction.timestamp,
          );

          if (stakeScore.combined.isLessThan(getMinStake(epoch))) {
            return;
          }

          const { txGasUsed, contract, gasSpentInChainCurrencyWei } =
            transaction;

          const currencyRate = resolvePrice(+transaction.timestamp);

          assert(
            currencyRate,
            `could not retrieve vlr/chaincurrency same day rate for swap at ${transaction.timestamp}`,
          );

          const currGasUsedChainCur = transaction.txGasUsedUSD // if USD override is available, most likely it's delta -> adjust spent eth and vlr to refund based on that
            ? new BigNumber(
                new BigNumber(transaction.txGasUsedUSD)
                  .multipliedBy(10 ** 18)
                  .dividedBy(currencyRate.chainPrice)
                  .toFixed(0),
              )
            : gasSpentInChainCurrencyWei
            ? new BigNumber(gasSpentInChainCurrencyWei)
            : new BigNumber(txGasUsed).multipliedBy(
                transaction.txGasPrice.toString(),
              ); // in wei

          const currGasUsedUSD = transaction.txGasUsedUSD
            ? new BigNumber(transaction.txGasUsedUSD)
            : currGasUsedChainCur
                .multipliedBy(currencyRate.chainPrice)
                .dividedBy(10 ** 18); // chaincurrency always encoded in 18decimals

          const currGasFeeVlr = currGasUsedChainCur.dividedBy(
            currencyRate.vlrToChainCurRate,
          );

          const totalStakeAmountVlr = stakeScore.combined.toFixed(0); // @todo irrelevant?
          const refundPercent = computeRefundPercent(
            epoch,
            totalStakeAmountVlr,
          );

          if (epoch < GasRefundV2EpochFlip) {
            assert(
              refundPercent,
              `Logic Error: failed to find refund percent for ${address}`,
            );
          }

          const currRefundedAmountVlr = currGasFeeVlr.multipliedBy(
            refundPercent || 0,
          );

          const currRefundedAmountUSD = currRefundedAmountVlr
            .multipliedBy(currencyRate.vlrPrice)
            .dividedBy(10 ** 18); // vlr decimals always encoded in 18decimals

          if (currRefundedAmountVlr.lt(0)) {
            debugger;
          }
          const refundableTransaction: GasRefundTransactionDataWithStakeScore_V3 =
            {
              epoch,
              address,
              chainId,
              hash: transaction.txHash,
              block: +transaction.blockNumber,
              timestamp: +transaction.timestamp,

              vlrUsd: currencyRate.vlrPrice,

              gasUsedUSD: currGasUsedUSD.toFixed(), // purposefully not rounded to preserve dollar amount precision - purely debug / avoid 0$ values in db
              totalStakeAmountVLR: totalStakeAmountVlr, // purposefully not rounded to preserve dollar amount precision [IMPORTANT FOR CALCULATIONS]
              refundedAmountVLR: currRefundedAmountVlr.toFixed(0),
              refundedAmountUSD: currRefundedAmountUSD.toFixed(), // purposefully not rounded to preserve dollar amount precision [IMPORTANT FOR CALCULCATIONS]
              contract,
              status: TransactionStatus.IDLE,
              paraBoostFactor: 1,
              stakeScore,
            };

          return refundableTransaction;
        })
        .filter(isTruthy);

    return refundableTransactions;
  };
}

export async function fetchRefundableTransactions_V3({
  chainId,
  startTimestamp,
  endTimestamp,
  epoch,
  resolvePrice,
}: {
  chainId: number;
  startTimestamp: number;
  endTimestamp: number;
  epoch: number;
  resolvePrice: PriceResolverFn_V3;
}): Promise<GasRefundTransactionDataWithStakeScore_V3[]> {
  const logger = global.LOGGER(
    `GRP:fetchRefundableTransactions_V3: epoch=${epoch}, chainId=${chainId}`,
  );

  logger.info(`start indexing between ${startTimestamp} and ${endTimestamp}`);

  const lastTimestampTxByContract = await fetchLastTimestampTxByContract_V3({
    chainId,
    epoch,
  });

  let allButV6ContractAddresses = getContractAddresses({ epoch, chainId });

  if (epoch >= GasRefundV2PIP55) {
    // starting from epoch 56 we no longer refund augustus v5 txs
    allButV6ContractAddresses = allButV6ContractAddresses.filter(
      contract => contract !== AUGUSTUS_V5_ADDRESS,
    );
  }

  const processRawTxs = constructTransactionsProcessor_V3({
    chainId,
    epoch,
    resolvePrice,
  });

  const allTxsAndV6Combined = await Promise.all([
    ...Array.from(AUGUSTUS_SWAPPERS_V6_OMNICHAIN)
      .concat(
        '0x0000000000bbf5c5fd284e657f01bd000933c96d', // delta v2
      )
      .map(async contractAddress => {
        const epochNewStyle = epoch - GasRefundV2EpochFlip;

        const lastTimestampProcessed =
          lastTimestampTxByContract[contractAddress];

        const allStakersTransactionsDuringEpoch =
          await fetchParaswapV6StakersTransactions_V3({
            epoch: epochNewStyle,
            timestampGreaterThan: lastTimestampProcessed,
            chainId,
            address: contractAddress,
          });

        return await processRawTxs(
          allStakersTransactionsDuringEpoch,
          (epoch, totalUserScore) => getRefundPercentV3(totalUserScore),
        );
      }),
  ]);

  const txsWithScores = allTxsAndV6Combined.flat();

  await storeTxs_V3({
    txsWithScores,
    logger,
  });
  return txsWithScores;
}

export async function storeTxs_V3({
  txsWithScores: refundableTransactions,
  logger,
}: {
  txsWithScores: GasRefundTransactionDataWithStakeScore_V3[];
  logger: Logger;
}) {
  if (refundableTransactions.length > 0) {
    logger.info(
      `updating total of ${refundableTransactions.length} for this chan and epoch`,
    );
    await writeTransactions_V3(refundableTransactions);

    const stakeScoreEntries = refundableTransactions
      .map(({ stakeScore, ...transaction }) =>
        composeGasRefundTransactionStakeSnapshots_V3(transaction, stakeScore),
      )
      .flat();

    await writeStakeScoreSnapshots_V3(stakeScoreEntries);
  }
}
