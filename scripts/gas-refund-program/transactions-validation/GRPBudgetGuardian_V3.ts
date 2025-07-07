import BigNumber from 'bignumber.js';
import { assert } from 'ts-essentials';
import { ZERO_BN } from '../../../src/lib/utils/helpers';
import {
  GasRefundV2EpochFlip,
  GasRefundV2EpochPSPEP3Flip,
} from '../../../src/lib/gas-refund/gas-refund';
import { fetchTotalRefundedAmountUSDByAddress_V3, fetchTotalRefundedVLR_V3 } from '../persistance/db-persistance_V3';

export const MAX_VLR_GLOBAL_BUDGET_YEARLY = new BigNumber(
  30_000_000,
).multipliedBy(10 ** 18);
export const MAX_USD_ADDRESS_BUDGET_YEARLY = new BigNumber(30_000);
export const MAX_USD_ADDRESS_BUDGET_EPOCH_V1 = new BigNumber(1_250); // should have been MAX_USD_ADDRESS_BUDGET_YEARLY.dividedBy(TOTAL_EPOCHS_IN_YEAR) but voted 1250
export const MAX_USD_ADDRESS_BUDGET_EPOCH_V2 = new BigNumber(2_500);
export const MAX_USD_ADDRESS_BUDGET_EPOCH_V2_PSPEP3 = new BigNumber(500);

export type GRPSystemState = {
  totalVlrRefundedForYear: BigNumber;
  totalRefundedUSDByAddressForYear: { [address: string]: BigNumber };
  totalRefundedUSDByAddressForEpoch: { [address: string]: BigNumber };
};

/* Gas Refund System Guardian is meant to implement proposal limitations; initially local limit of 30k$ per address and global limit of 30M VLR
 * This loads the current state of the system from database and resolve whether any limits are violated
 * some optimistic in memory updates are inferred to avoid querying database too often
 */
export class GRPBudgetGuardian_V3 {
  state: GRPSystemState;

  static instance: GRPBudgetGuardian_V3;

  static getInstance() {
    if (!this.instance) {
      this.instance = new GRPBudgetGuardian_V3();
    }

    return this.instance;
  }

  async loadStateFromDB(startEpoch: number, toEpoch?: number) {
    const [totalVlrRefundedForYear, totalRefundedUSDByAddressForYear] =
      await Promise.all([
        fetchTotalRefundedVLR_V3(startEpoch, toEpoch),
        fetchTotalRefundedAmountUSDByAddress_V3(startEpoch, toEpoch),
      ]);

    this.state = {
      totalVlrRefundedForYear,
      totalRefundedUSDByAddressForYear,
      totalRefundedUSDByAddressForEpoch: {}, // no need to preload as validation runs on full epoch from scratch
    };
  }

  getMaxRefundUSDBudgetForEpoch(epoch: number) {
    return epoch < GasRefundV2EpochFlip
      ? MAX_USD_ADDRESS_BUDGET_EPOCH_V1
      : epoch < GasRefundV2EpochPSPEP3Flip
      ? MAX_USD_ADDRESS_BUDGET_EPOCH_V2
      : MAX_USD_ADDRESS_BUDGET_EPOCH_V2_PSPEP3;
  }

  // ---------  VLR Global Yearly Budget Limit ---------
  isMaxYearlyVlrGlobalBudgetSpent() {
    return this.state.totalVlrRefundedForYear.isGreaterThanOrEqualTo(
      MAX_VLR_GLOBAL_BUDGET_YEARLY,
    );
  }

  assertMaxYearlyVlrGlobalBudgetNotSpent() {
    assert(
      !this.isMaxYearlyVlrGlobalBudgetSpent(),
      'Max VLR global budget spent',
    );
  }

  increaseTotalRefundedVLR(amount: BigNumber) {
    this.state.totalVlrRefundedForYear = (
      this.state.totalVlrRefundedForYear || ZERO_BN
    ).plus(amount);
  }

  // ---------  USD Per User Yearly Budget Limit ---------
  totalYearlyRefundedUSD(account: string) {
    return this.state.totalRefundedUSDByAddressForYear[account] || ZERO_BN;
  }

  hasSpentYearlyUSDBudget(account: string) {
    return this.totalYearlyRefundedUSD(account).isGreaterThanOrEqualTo(
      MAX_USD_ADDRESS_BUDGET_YEARLY,
    );
  }

  increaseYearlyRefundedUSD(account: string, usdAmount: BigNumber) {
    this.state.totalRefundedUSDByAddressForYear[account] =
      this.totalYearlyRefundedUSD(account).plus(usdAmount);
  }

  // ---------  USD Per User Epoch Based Budget Limit ---------
  totalRefundedUSDForEpoch(account: string) {
    return this.state.totalRefundedUSDByAddressForEpoch[account] || ZERO_BN;
  }

  hasSpentUSDBudgetForEpoch(account: string, epoch: number) {
    const maxBudgetEpoch = this.getMaxRefundUSDBudgetForEpoch(epoch);

    return this.totalRefundedUSDForEpoch(account).isGreaterThanOrEqualTo(
      maxBudgetEpoch,
    );
  }

  increaseRefundedUSDForEpoch(account: string, usdAmount: BigNumber) {
    this.state.totalRefundedUSDByAddressForEpoch[account] =
      this.totalRefundedUSDForEpoch(account).plus(usdAmount);
  }

  // ------------ cleaning -----
  resetYearlyBudgetState() {
    this.state.totalVlrRefundedForYear = ZERO_BN;
    this.state.totalRefundedUSDByAddressForYear = {};
  }

  resetEpochBudgetState() {
    this.state.totalRefundedUSDByAddressForEpoch = {};
  }
}
