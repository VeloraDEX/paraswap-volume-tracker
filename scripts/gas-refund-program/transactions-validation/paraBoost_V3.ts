import { assert } from 'ts-essentials';
import { GasRefundV2EpochFlip } from '../../../src/lib/gas-refund/gas-refund';
import { fetchAccountsScores_V3 } from '../../../src/lib/utils/staking-supervisor';

export type ParaBoostPerAccount = { [account: string]: number };

export async function fetchParaBoostPerAccount_V3(epoch1: number) {
  const epoch2 = epoch1 - GasRefundV2EpochFlip;

  assert(epoch2 >= 0, 'epoch2 can never be negative');

  const data = await fetchAccountsScores_V3(epoch2);

  const paraBoostFactorByAccount = data.reduce<ParaBoostPerAccount>(
    (acc, paraBoostData: { paraBoostFactor: string; account: string }) => {
      const paraBoostFactor = parseFloat(paraBoostData.paraBoostFactor);
      assert(
        paraBoostFactor >= 1,
        'paraBoostFacotr should always be greater or equal than 1',
      );
      acc[paraBoostData.account.toLowerCase()] = paraBoostFactor;
      return acc;
    },
    {},
  );

  return paraBoostFactorByAccount;
}

export const constructFetchParaBoostPerAccountMem_V3 = () => {
  let memEpoch1: number;
  let memData: ParaBoostPerAccount;

  return async (epoch1: number) => {
    if (epoch1 === memEpoch1) {
      assert(memData, 'paraBoost data should be defined here');
      return memData;
    }
    memData = await fetchParaBoostPerAccount_V3(epoch1);
    memEpoch1 = epoch1;
    return memData;
  };
};
