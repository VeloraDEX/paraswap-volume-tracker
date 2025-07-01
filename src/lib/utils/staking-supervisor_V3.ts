import axios from 'axios';

export type MinParaBoostData_V3 = {
  account: string;
  score: string;
  stakesScore: string;
  seXYZUnderlyingXYZBalance: string;
  paraBoostFactor: string;
};

export async function fetchAccountsScores_V3(
  epochv2: number,
): Promise<MinParaBoostData_V3[]> {
  // v3

  const { data } = await axios.get<MinParaBoostData_V3[]>(
    // `https://api.paraswap.io/stk/paraboost/v3/list?epoch=${epochv2}`,

    // TODO: remove this "-1" thing. Purpose of it  was - test prev distribution. For that should have been stakers in the past epoch + did transactions in the past epoch, so gotta adjust here
    // tmp: work around "epoch should be lte currentEpoch=26" (at the time of writting it's not yet 27 epoch)
    `http://${process.env.PARABOOST_V3_API_BASE_URL}/paraboost/v3/list?epoch=${epochv2}`,
  );
  // because there's now only pooling boost and it now gets reset due to migration, it is now likely...
  // assert(
  //   data.length > 0,
  //   'logic error: unlikely that no paraboost was recorded',
  // );

  return data;
}
