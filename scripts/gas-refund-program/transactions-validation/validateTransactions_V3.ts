import BigNumber from 'bignumber.js';
import { Op } from 'sequelize';
import { assert } from 'ts-essentials';
import {
  GasRefundBudgetLimitEpochBasedStartEpoch,
  GasRefundGenesisEpoch,
  GasRefundPrecisionGlitchRefundedAmountsEpoch,
  GasRefundDeduplicationStartEpoch,
  GasRefundV2EpochFlip,
  getRefundPercent,
  TOTAL_EPOCHS_IN_YEAR,
  TransactionStatus,
  GRP_MAX_REFUND_PERCENT,
} from '../../../src/lib/gas-refund/gas-refund';

import { xnor } from '../../../src/lib/utils/helpers';
import {
  GRPBudgetGuardian_V3,
  MAX_VLR_GLOBAL_BUDGET_YEARLY,
  MAX_USD_ADDRESS_BUDGET_YEARLY,
} from './GRPBudgetGuardian_V3';
import {
  fetchMigrationsTxHashesSet,
  MIGRATION_SEPSP2_100_PERCENT_KEY,
} from '../staking/2.0/utils';

import { getCurrentEpoch } from '../../../src/lib/gas-refund/epoch-helpers';
import {
  constructFetchParaBoostPerAccountMem_V3,
  ParaBoostPerAccount,
} from './paraBoost_V3';
import { GasRefundTransaction_V3 } from '../../../src/models/GasRefundTransaction_V3';
import { fetchLastEpochRefunded } from '../persistance/db-persistance';
import { updateTransactionsStatusRefundedAmounts_V3 } from '../persistance/db-persistance_V3';

/**
 * This function guarantees that the order of transactions refunded will always be stable.
 * This is particularly important as we approach either per-address or global budget limit.
 * Because some transactions from some data source can arrive later, we need to reassess the status of all transactions for all chains for whole epoch.
 *
 * The solution is to:
 * - load current budgetGuardian to get snapshot of budgets spent
 * - scan all transaction since last epoch refunded in batch
 * - flag each transaction as either validated or rejected if it reached the budget
 * - update in memory budget accountability through budgetGuardian on validated transactions
 * - write back status of tx in database if changed
 */
const logger = global.LOGGER('GRP::validateTransactions_V3');

// computing chainId_txHash so no need to assume anything about tx hashes collision across all chains
const hashKey = (t: GasRefundTransaction_V3) => `${t.chainId}_${t.hash}`;

const paraBoostFetcher = constructFetchParaBoostPerAccountMem_V3();

let paraBoostByAccount: ParaBoostPerAccount;

export async function validateTransactions_V3() {
  const guardian = GRPBudgetGuardian_V3.getInstance();

  const lastEpochRefunded = await fetchLastEpochRefunded();
  const migrationsTxsHashesSet = await fetchMigrationsTxHashesSet();

  const firstEpochOfYear = !!lastEpochRefunded // Verify logic add assert?
    ? GasRefundGenesisEpoch +
      lastEpochRefunded -
      (lastEpochRefunded % TOTAL_EPOCHS_IN_YEAR)
    : GasRefundGenesisEpoch;

  const startEpochForTxValidation = !lastEpochRefunded
    ? firstEpochOfYear
    : lastEpochRefunded + 1;

  // reload budget guardian state till last epoch refunded (exclusive)
  await guardian.loadStateFromDB(firstEpochOfYear, startEpochForTxValidation);

  let offset = 0;
  const pageSize = 1000;

  const uniqTxHashesForEpoch = new Set<string>();

  while (true) {
    // scan transactions in batch sorted by timestamp and hash to guarantee stability
    const transactionsSlice = await GasRefundTransaction_V3.findAll({
      where: {
        epoch: {
          [Op.gte]: startEpochForTxValidation,
        },
      },
      order: ['timestamp', 'hash'],
      limit: pageSize,
      offset,
      raw: true,
    });

    if (!transactionsSlice.length) {
      break;
    }

    offset += pageSize;

    const updatedTransactions = [];

    let prevEpoch = transactionsSlice[0].epoch;

    if (prevEpoch >= GasRefundV2EpochFlip) {
      paraBoostByAccount = await paraBoostFetcher(prevEpoch);
    }

    for (const tx of transactionsSlice) {
      const { address, status, totalStakeAmountVLR, vlrUsd, gasUsedUSD } = tx;

      assert(
        tx.hash == tx.hash.toLowerCase(),
        'Logic Error: hashes should always be lowercased',
      );

      let newStatus;

      // a migration from staking V1 to V2 should be refunded exactly once
      // as staking txs are subject to refunding, we have to prevent double spending on marginal cases
      const isMigrationToV2Tx =
        tx.contract === MIGRATION_SEPSP2_100_PERCENT_KEY;

      if (isMigrationToV2Tx) {
        assert(
          migrationsTxsHashesSet.has(tx.hash),
          'Logic Error: migration txs set should always be containing all txs before running validation',
        );
      }

      if (prevEpoch !== tx.epoch) {
        // clean epoch based state on each epoch change
        guardian.resetEpochBudgetState();

        // clean yearly based state every 26 epochs
        if ((tx.epoch - GasRefundGenesisEpoch) % TOTAL_EPOCHS_IN_YEAR === 0) {
          guardian.resetYearlyBudgetState();
        }

        uniqTxHashesForEpoch.clear();

        // refetch paraBoost data on epoch switch
        if (tx.epoch >= GasRefundV2EpochFlip) {
          paraBoostByAccount = await paraBoostFetcher(tx.epoch);
        }

        prevEpoch = tx.epoch;
      }

      let refundPercentage: number | undefined;

      //  GRP2.0: take into account boost at end of epoch
      const isGRP2GracePeriod =
        tx.epoch >= GasRefundV2EpochFlip && getCurrentEpoch() > tx.epoch;

      if (isGRP2GracePeriod) {
        assert(paraBoostByAccount, 'paraBoostByAccount should be defined');
        const paraBoostFactor = paraBoostByAccount[tx.address] || 1;
        const fullParaBoostScore = new BigNumber(totalStakeAmountVLR)
          .multipliedBy(paraBoostFactor)
          .decimalPlaces(0, BigNumber.ROUND_DOWN)
          .toFixed();

        refundPercentage = getRefundPercent(tx.epoch, fullParaBoostScore);
      } else {
        // fall here on GRP1 and GRP2 during epoch
        refundPercentage = getRefundPercent(tx.epoch, totalStakeAmountVLR);
      }

      assert(
        typeof refundPercentage === 'number',
        'logic error: refunded percent should be defined',
      );

      if (tx.epoch < GasRefundV2EpochFlip) {
        assert(
          refundPercentage > 0,
          'logic error: refundPercentage should be > 0 on grp1.0',
        );
      }

      // GRP1.0: recompute refunded amounts as logic alters those values as we reach limits
      // GRP2.0: like GRP1.0 but also recompute refunded amounts after end of epoch to account for boosts
      let _refundedAmountVlr = new BigNumber(gasUsedUSD)
        .dividedBy(vlrUsd)
        .multipliedBy(refundPercentage || 0); // keep it decimals to avoid rounding errors

      if (tx.epoch === GasRefundPrecisionGlitchRefundedAmountsEpoch) {
        _refundedAmountVlr = _refundedAmountVlr.decimalPlaces(0);
      }

      const recomputedRefundedAmountUSD = _refundedAmountVlr
        .multipliedBy(vlrUsd)
        .dividedBy(10 ** 18); // vlr decimals always encoded in 18decimals

      const recomputedRefundedAmountVlr = _refundedAmountVlr.decimalPlaces(0); // truncate decimals to align with values in db

      let cappedRefundedAmountVLR: BigNumber | undefined;
      let cappedRefundedAmountUSD: BigNumber | undefined;

      if (
        !isMigrationToV2Tx && // always refund migration txs (100%)
        (guardian.isMaxYearlyVlrGlobalBudgetSpent() ||
          guardian.hasSpentYearlyUSDBudget(address) ||
          (tx.epoch >= GasRefundBudgetLimitEpochBasedStartEpoch &&
            guardian.hasSpentUSDBudgetForEpoch(address, tx.epoch)) ||
          (tx.epoch >= GasRefundDeduplicationStartEpoch &&
            uniqTxHashesForEpoch.has(hashKey(tx))) || // prevent double spending overall
          migrationsTxsHashesSet.has(tx.hash)) // avoid double spending for twin migration txs (with contract set to actual contract address). Order of txs matters
      ) {
        newStatus = TransactionStatus.REJECTED;
      } else {
        newStatus = TransactionStatus.VALIDATED;

        // should never cap migration txs
        if (isMigrationToV2Tx) {
          assert(
            Math.abs(+tx.refundedAmountUSD - +tx.gasUsedUSD) < 10 ** -4, // epsilon value
            'logic error: migration tx should always be valid and get fully refunded',
          );
        } else {
          ({ cappedRefundedAmountVLR, cappedRefundedAmountUSD } =
            tx.epoch < GasRefundBudgetLimitEpochBasedStartEpoch
              ? capRefundedAmountsBasedOnYearlyDollarBudget(
                  address,
                  recomputedRefundedAmountUSD,
                  vlrUsd,
                )
              : capRefundedAmountsBasedOnEpochDollarBudget(
                  address,
                  recomputedRefundedAmountUSD,
                  vlrUsd,
                  tx.epoch,
                ));

          cappedRefundedAmountVLR = capRefundedVlrAmountBasedOnYearlyVlrBudget(
            cappedRefundedAmountVLR,
            recomputedRefundedAmountVlr,
          );

          if (tx.epoch >= GasRefundBudgetLimitEpochBasedStartEpoch) {
            guardian.increaseRefundedUSDForEpoch(
              address,
              cappedRefundedAmountUSD || recomputedRefundedAmountUSD,
            );
          }

          guardian.increaseYearlyRefundedUSD(
            address,
            cappedRefundedAmountUSD || recomputedRefundedAmountUSD,
          );

          guardian.increaseTotalRefundedVLR(
            cappedRefundedAmountVLR || recomputedRefundedAmountVlr,
          );
        }
      }

      assert(
        xnor(cappedRefundedAmountVLR, cappedRefundedAmountUSD),
        'Either both cappedRefundedAmountVLR and cappedRefundedAmountUSD should be falsy or truthy',
      );

      uniqTxHashesForEpoch.add(hashKey(tx));

      if (tx.epoch < GasRefundV2EpochFlip) {
        if (status !== newStatus || !!cappedRefundedAmountVLR) {
          updatedTransactions.push({
            ...tx,
            ...(!!cappedRefundedAmountVLR
              ? { refundedAmountVLR: cappedRefundedAmountVLR.toFixed(0) }
              : {}),
            ...(!!cappedRefundedAmountUSD
              ? { refundedAmountUSD: cappedRefundedAmountUSD.toFixed() } // purposefully not rounded to preserve dollar amount precision [IMPORTANT FOR CALCULCATIONS]
              : {}),
            status: newStatus,
          });
        }
      } else {
        assert(paraBoostByAccount, 'paraBoostByAccount should be defined'); // important for next invariant check
        const paraBoostFactor = paraBoostByAccount[tx.address] || 1; // it can happen that user was staked during epoch but unstaked later, in such case boost is lost

        const updatedTx = {
          ...tx,
          status: newStatus,
          paraBoostFactor,
        };

        if (isMigrationToV2Tx) {
          // not safe to take
          assert(
            tx.contract === MIGRATION_SEPSP2_100_PERCENT_KEY,
            'logic error should have migration txs here',
          );
          assert(
            newStatus == TransactionStatus.VALIDATED,
            'migration txs can only be valided',
          );
          // as logic up doesn't prevent recalculating refunded amount migration txs.
          // use this as an opportunity to check multiple invariant
          // - migration tx should alwasys be refunded 100%
          // - computed refund should never go > 95%
          assert(
            BigInt(tx.refundedAmountVLR) >
              BigInt(recomputedRefundedAmountVlr.toFixed(0)),
            'refunded amount VLR should always be strictly here thn recomputed amount',
          );
          updatedTransactions.push(updatedTx);
        } else {
          assert(
            refundPercentage <= GRP_MAX_REFUND_PERCENT,
            'refunded percent should be computed and lower than max',
          );
          const updatedRefundedAmountVlr = (
            cappedRefundedAmountVLR || recomputedRefundedAmountVlr
          ).toFixed(0);
          const updatedRefundedAmountUSD = (
            cappedRefundedAmountUSD || recomputedRefundedAmountUSD
          ).toFixed();

          if (refundPercentage == 0) {
            assert(
              updatedRefundedAmountVlr === '0' &&
                updatedRefundedAmountUSD === '0',
              'logic error',
            );
          } else {
            assert(
              updatedRefundedAmountVlr !== '0' &&
                updatedRefundedAmountUSD !== '0',
              'logic error',
            );
          }

          if (tx.refundedAmountVLR !== updatedRefundedAmountVlr) {
            assert(
              tx.refundedAmountUSD !== updatedRefundedAmountUSD,
              'should always update usd amount along with vlr amount',
            );

            if (paraBoostFactor > 1) {
              if (refundPercentage < GRP_MAX_REFUND_PERCENT) {
                // amend: asserts do not make sense here
                // assert(
                //   BigInt(tx.refundedAmountPSP) <
                //     BigInt(recomputedRefundedAmountPSP.toFixed(0)),
                //   'logic error: account has boost, recomputed amount should be higher',
                // );
              } else {
                assert(
                  BigInt(tx.refundedAmountVLR) <=
                    BigInt(recomputedRefundedAmountVlr.toFixed(0)),
                  'logic error: account has boost, recomputed amount should be at least higher than previous on max',
                );
              }
            }

            updatedTransactions.push({
              ...updatedTx,
              refundedAmountVLR: updatedRefundedAmountVlr,
              refundedAmountUSD: updatedRefundedAmountUSD,
            });
          } else {
            // can land here if account has 0 or recomputed amounts are exactly matching
            updatedTransactions.push(updatedTx);
          }
        }
      }
    }

    if (updatedTransactions.length > 0) {
      await updateTransactionsStatusRefundedAmounts_V3(updatedTransactions);
    }

    if (transactionsSlice.length < pageSize) {
      break; // micro opt to avoid querying db for last page
    }
  }

  const numOfIdleTxs = await GasRefundTransaction_V3.count({
    where: { status: TransactionStatus.IDLE },
  });

  assert(
    numOfIdleTxs === 0,
    `there should be 0 idle transactions at the end of validation step`,
  );
}

type CappedAmounts = {
  cappedRefundedAmountUSD: BigNumber | undefined;
  cappedRefundedAmountVLR: BigNumber | undefined;
};

function capRefundedAmountsBasedOnYearlyDollarBudget(
  address: string,
  refundedAmountUSD: BigNumber,
  vlrUsd: number,
): CappedAmounts {
  const guardian = GRPBudgetGuardian_V3.getInstance();
  let cappedRefundedAmountUSD;
  let cappedRefundedAmountVLR;

  if (
    guardian
      .totalYearlyRefundedUSD(address)
      .plus(refundedAmountUSD)
      .isGreaterThan(MAX_USD_ADDRESS_BUDGET_YEARLY)
  ) {
    cappedRefundedAmountUSD = MAX_USD_ADDRESS_BUDGET_YEARLY.minus(
      guardian.totalYearlyRefundedUSD(address),
    );

    assert(
      cappedRefundedAmountUSD.isGreaterThanOrEqualTo(0),
      'Logic Error: quantity cannot be negative, this would mean we priorly refunded more than max',
    );

    cappedRefundedAmountVLR = cappedRefundedAmountUSD
      .dividedBy(vlrUsd)
      .multipliedBy(10 ** 18)
      .decimalPlaces(0);
  }

  return { cappedRefundedAmountUSD, cappedRefundedAmountVLR };
}

function capRefundedAmountsBasedOnEpochDollarBudget(
  address: string,
  refundedAmountUSD: BigNumber,
  vlrUsd: number,
  epoch: number,
): CappedAmounts {
  const guardian = GRPBudgetGuardian_V3.getInstance();

  const maxUsdBudgetPerEpochPerAcc =
    guardian.getMaxRefundUSDBudgetForEpoch(epoch);

  if (
    guardian
      .totalYearlyRefundedUSD(address)
      .plus(refundedAmountUSD)
      .isGreaterThan(MAX_USD_ADDRESS_BUDGET_YEARLY)
  ) {
    return capRefundedAmountsBasedOnYearlyDollarBudget(
      address,
      refundedAmountUSD,
      vlrUsd,
    );
  }

  let cappedRefundedAmountUSD;
  let cappedRefundedAmountVLR;

  if (
    guardian
      .totalRefundedUSDForEpoch(address)
      .plus(refundedAmountUSD)
      .isGreaterThan(maxUsdBudgetPerEpochPerAcc)
  ) {
    cappedRefundedAmountUSD = maxUsdBudgetPerEpochPerAcc.minus(
      guardian.totalRefundedUSDForEpoch(address),
    );

    assert(
      cappedRefundedAmountUSD.isGreaterThanOrEqualTo(0),
      'Logic Error: quantity cannot be negative, this would mean we priorly refunded more than max',
    );

    cappedRefundedAmountVLR = cappedRefundedAmountUSD
      .dividedBy(vlrUsd)
      .multipliedBy(10 ** 18)
      .decimalPlaces(0);
  }

  return { cappedRefundedAmountUSD, cappedRefundedAmountVLR };
}

function capRefundedVlrAmountBasedOnYearlyVlrBudget(
  cappedRefundedAmountVlr: BigNumber | undefined,
  refundedAmountVlr: BigNumber,
): BigNumber | undefined {
  const guardian = GRPBudgetGuardian_V3.getInstance();

  const hasCrossedYearlyVlrBuget = guardian.state.totalVlrRefundedForYear
    .plus(cappedRefundedAmountVlr || refundedAmountVlr)
    .isGreaterThan(MAX_VLR_GLOBAL_BUDGET_YEARLY);

  if (!hasCrossedYearlyVlrBuget) {
    return cappedRefundedAmountVlr;
  }

  // Note: updating refundedAmountUSD does not matter if global budget limit is reached
  const cappedToMax = MAX_VLR_GLOBAL_BUDGET_YEARLY.minus(
    guardian.state.totalVlrRefundedForYear,
  );

  // if transaction has been capped in upper handling, take min to avoid accidentally pushing per address limit
  const _cappedRefundedAmountVlr = cappedRefundedAmountVlr
    ? BigNumber.min(cappedRefundedAmountVlr, cappedToMax)
    : cappedToMax;

  assert(
    _cappedRefundedAmountVlr.lt(refundedAmountVlr),
    'the capped amount should be lower than original one',
  );

  return _cappedRefundedAmountVlr;
}
